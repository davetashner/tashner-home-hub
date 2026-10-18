import { describe, expect, it, vi } from 'vitest';
import type { KidGroup } from './kid-chores';
import type { KidRoutine } from './routines';
import {
	backoffMs,
	overlayMeals,
	overlayQueued,
	overlayRoutineSteps,
	classifyStatus,
	WriteQueue,
	type QueuedWrite,
	type SendResult
} from './write-queue';

function setup(results: SendResult[] = []) {
	let stored: QueuedWrite[] = [];
	let t = 1_000;
	let n = 0;
	const sent: QueuedWrite[] = [];
	const drops: [string, string][] = [];
	const sizes: number[] = [];
	const queue = new WriteQueue({
		storage: {
			load: async () => stored,
			save: async (items) => void (stored = items)
		},
		send: async (w) => {
			sent.push(w);
			return results.shift() ?? 'ok';
		},
		now: () => t,
		newId: () => `k${++n}`,
		onDrop: (w, reason) => drops.push([w.choreId ?? '', reason]),
		onChange: (s) => sizes.push(s)
	});
	return {
		queue,
		sent,
		drops,
		sizes,
		stored: () => stored,
		advance: (ms: number) => (t += ms)
	};
}

const complete = (choreId: string) => ({
	kind: 'complete' as const,
	url: `/api/chores/${choreId}/complete`,
	body: { memberId: 'm' },
	choreId
});

describe('WriteQueue', () => {
	it('persists writes with unique stable idempotency keys', async () => {
		const s = setup();
		const a = await s.queue.enqueue(complete('c1'));
		const b = await s.queue.enqueue(complete('c2'));
		expect(a.key).not.toBe(b.key);
		expect(s.stored().map((w) => w.key)).toEqual([a.key, b.key]);
		expect(s.sizes).toEqual([1, 2]);
		expect(await s.queue.size()).toBe(2);
		expect((await s.queue.pending()).length).toBe(2);
	});

	it('replays in order and empties the queue', async () => {
		const s = setup();
		await s.queue.enqueue(complete('c1'));
		await s.queue.enqueue(complete('c2'));
		await s.queue.enqueue({
			kind: 'undo',
			url: '/api/completions/x/undo',
			body: {},
			choreId: 'c3'
		});
		expect(await s.queue.flush()).toBe(3);
		expect(s.sent.map((w) => w.choreId)).toEqual(['c1', 'c2', 'c3']);
		expect(await s.queue.size()).toBe(0);
	});

	it('stops at a retry, keeps order, and backs off', async () => {
		const s = setup(['retry']);
		const first = await s.queue.enqueue(complete('c1'));
		await s.queue.enqueue(complete('c2'));
		expect(await s.queue.flush()).toBe(0);
		expect(s.sent).toHaveLength(1);
		const [head] = await s.queue.pending();
		expect(head.attempts).toBe(1);
		expect(head.key).toBe(first.key);
		// Not due yet: nothing is sent.
		expect(await s.queue.flush()).toBe(0);
		expect(s.sent).toHaveLength(1);
		s.advance(backoffMs(1));
		expect(await s.queue.flush()).toBe(2);
		expect(s.sent.map((w) => w.key)).toEqual([first.key, first.key, 'k2']);
	});

	it('ignores backoff when forced (reconnect)', async () => {
		const s = setup(['retry']);
		await s.queue.enqueue(complete('c1'));
		await s.queue.flush();
		expect(await s.queue.flush(true)).toBe(1);
	});

	it('grows the backoff and caps it', () => {
		expect(backoffMs(1)).toBe(1_000);
		expect(backoffMs(2)).toBe(2_000);
		expect(backoffMs(4)).toBe(8_000);
		expect(backoffMs(99)).toBe(60_000);
		expect(backoffMs(0)).toBe(1_000);
	});

	it('drops expired undos without sending them', async () => {
		const s = setup();
		await s.queue.enqueue({
			kind: 'undo',
			url: '/api/completions/x/undo',
			body: {},
			choreId: 'c1',
			expiresAt: 1_000 + 10_000
		});
		await s.queue.enqueue(complete('c2'));
		s.advance(10_001);
		expect(await s.queue.flush()).toBe(1);
		expect(s.sent.map((w) => w.choreId)).toEqual(['c2']);
		expect(s.drops).toEqual([['c1', 'expired']]);
	});

	it('sends an undo that is still inside its window', async () => {
		const s = setup();
		await s.queue.enqueue({
			kind: 'undo',
			url: '/u',
			body: {},
			choreId: 'c1',
			expiresAt: 1_000 + 10_000
		});
		s.advance(5_000);
		expect(await s.queue.flush()).toBe(1);
		expect(s.drops).toEqual([]);
	});

	it('drops rejected writes and carries on', async () => {
		const s = setup(['drop', 'ok']);
		await s.queue.enqueue(complete('c1'));
		await s.queue.enqueue(complete('c2'));
		expect(await s.queue.flush()).toBe(1);
		expect(s.drops).toEqual([['c1', 'rejected']]);
	});

	it('cancels an unsent completion, and only that', async () => {
		const s = setup();
		await s.queue.enqueue(complete('c1'));
		await s.queue.enqueue(complete('c2'));
		expect(await s.queue.cancelComplete('c1')).toBe(true);
		expect(await s.queue.cancelComplete('c1')).toBe(false);
		await s.queue.flush();
		expect(s.sent.map((w) => w.choreId)).toEqual(['c2']);
	});

	it('shares one flush between concurrent callers', async () => {
		const s = setup();
		await s.queue.enqueue(complete('c1'));
		const [a, b] = await Promise.all([s.queue.flush(), s.queue.flush()]);
		expect(a).toBe(1);
		expect(b).toBe(1);
		expect(s.sent).toHaveLength(1);
	});

	it('runs a forced flush after an in-flight one instead of joining it (reconnect mid-send)', async () => {
		const s = setup(['retry']);
		await s.queue.enqueue(complete('c1'));
		const offlineTry = s.queue.flush();
		const reconnect = s.queue.flush(true);
		expect(await offlineTry).toBe(0);
		expect(await reconnect).toBe(1);
		expect(s.sent).toHaveLength(2);
		expect(s.stored()).toEqual([]);
	});

	it('reloads persisted writes after a restart', async () => {
		const s = setup();
		await s.queue.enqueue(complete('c1'));
		const saved = s.stored();
		const send = vi.fn(async () => 'ok' as const);
		const revived = new WriteQueue({
			storage: { load: async () => saved, save: async () => {} },
			send,
			now: () => 5_000,
			newId: () => 'z'
		});
		expect(await revived.flush()).toBe(1);
		expect(send).toHaveBeenCalledOnce();
	});
});

describe('classifyStatus', () => {
	it('retries server trouble and drops client errors', () => {
		expect(classifyStatus(200)).toBe('ok');
		expect(classifyStatus(204)).toBe('ok');
		expect(classifyStatus(503)).toBe('retry');
		expect(classifyStatus(429)).toBe('retry');
		expect(classifyStatus(408)).toBe('retry');
		expect(classifyStatus(404)).toBe('drop');
		expect(classifyStatus(409)).toBe('drop');
	});
});

describe('overlayQueued', () => {
	const board = (status: 'none' | 'pending'): KidGroup[] => [
		{
			timeOfDay: 'morning',
			chores: [{ id: 'c1', title: 'Bed', icon: null, stars: 1, status, completionId: null }]
		}
	];
	const write = (kind: 'complete' | 'undo', memberId: string): QueuedWrite => ({
		id: 'i',
		key: 'i',
		kind,
		url: '',
		body: { memberId },
		choreId: 'c1',
		queuedAt: 0,
		expiresAt: null,
		attempts: 0,
		nextAt: 0
	});

	it('shows a queued completion as pending for that member only', () => {
		expect(overlayQueued(board('none'), 'm', [write('complete', 'm')])[0].chores[0].status).toBe(
			'pending'
		);
		expect(
			overlayQueued(board('none'), 'm', [write('complete', 'other')])[0].chores[0].status
		).toBe('none');
	});

	it('shows a queued undo as not done', () => {
		expect(overlayQueued(board('pending'), 'm', [write('undo', 'm')])[0].chores[0].status).toBe(
			'none'
		);
	});
});

describe('routine step writes', () => {
	const step = (routineId: string, n: number) => ({
		kind: 'routine-step' as const,
		url: `/api/routines/${routineId}/progress`,
		body: { date: '2026-10-18', step: n },
		routineId
	});

	it('queues without a chore, keeps method and routine, and replays in order', async () => {
		const s = setup();
		await s.queue.enqueue(step('r1', 0));
		await s.queue.enqueue({ ...step('r1', 1), method: 'PUT' });
		const [a, b] = await s.queue.pending();
		expect(a).toMatchObject({ kind: 'routine-step', routineId: 'r1' });
		expect(a).not.toHaveProperty('choreId');
		expect(a).not.toHaveProperty('method');
		expect(b?.method).toBe('PUT');
		expect(await s.queue.flush()).toBe(2);
		expect(s.sent.map((w) => (w.body as { step: number }).step)).toEqual([0, 1]);
	});

	it('does not let a chore cancel touch routine steps', async () => {
		const s = setup();
		await s.queue.enqueue(step('r1', 0));
		expect(await s.queue.cancelComplete('r1')).toBe(false);
		expect(await s.queue.size()).toBe(1);
	});

	const routine = (id: string, done: number): KidRoutine => ({
		id,
		name: id,
		windowStart: null,
		windowEnd: null,
		steps: [
			{ label: 'a', icon: 'star' },
			{ label: 'b', icon: 'star' }
		],
		done
	});
	const queued = (routineId: string | undefined, kind: QueuedWrite['kind'], step: unknown) =>
		({
			id: 'i',
			key: 'i',
			kind,
			url: '',
			body: { step },
			routineId,
			queuedAt: 0,
			expiresAt: null,
			attempts: 0,
			nextAt: 0
		}) satisfies QueuedWrite;

	it('overlays queued steps on loaded routines, never backwards, ignoring junk', () => {
		const by = { m: [routine('r1', 0), routine('r2', 1)] };
		expect(overlayRoutineSteps(by, [])).toBe(by);
		const out = overlayRoutineSteps(by, [
			queued('r1', 'routine-step', 0),
			queued('r1', 'routine-step', 1),
			queued('r1', 'routine-step', 0),
			queued('r2', 'routine-step', 'x'),
			queued(undefined, 'routine-step', 1),
			queued('r2', 'complete', 1)
		]);
		expect(out.m?.map((r) => r.done)).toEqual([2, 1]);
	});

	it('overlayQueued ignores writes with no chore', () => {
		const board: KidGroup[] = [{ timeOfDay: 'morning', chores: [] }];
		expect(overlayQueued(board, 'm', [queued('r1', 'routine-step', 0)])).toEqual(board);
	});
});

describe('meal writes', () => {
	const meal = (method: 'PUT' | 'DELETE', body: unknown, kind: QueuedWrite['kind'] = 'meal') =>
		({
			id: 'i',
			key: 'i',
			kind,
			url: '/api/meals',
			method,
			body,
			queuedAt: 0,
			expiresAt: null,
			attempts: 0,
			nextAt: 0
		}) satisfies QueuedWrite;
	const MON = '2026-10-12';
	const week = { '2026-10-12|dinner': 'Soup', '2026-10-13|lunch': 'Rice' };

	it('queues PUT and DELETE with their url and body, replaying in order', async () => {
		const s = setup();
		await s.queue.enqueue({
			kind: 'meal',
			method: 'PUT',
			url: '/api/meals',
			body: { date: MON, meal: 'dinner', title: 'Soup' }
		});
		await s.queue.enqueue({
			kind: 'meal',
			method: 'DELETE',
			url: '/api/meals',
			body: { date: MON, meal: 'dinner' }
		});
		expect(await s.queue.flush()).toBe(2);
		expect(s.sent.map((w) => w.method)).toEqual(['PUT', 'DELETE']);
		expect(s.sent[0]).not.toHaveProperty('choreId');
	});

	it('overlays sets and clears in order on the right week only', () => {
		expect(overlayMeals(week, MON, [])).toBe(week);
		const out = overlayMeals(week, MON, [
			meal('PUT', { date: MON, meal: 'dinner', title: 'Pasta' }),
			meal('PUT', { date: '2026-10-14', meal: 'snack', title: 'Apple' }),
			meal('DELETE', { date: '2026-10-13', meal: 'lunch' }),
			meal('PUT', { date: '2026-10-19', meal: 'dinner', title: 'Other week' }),
			meal('PUT', { date: MON, meal: 'brunch', title: 'bad slot' }),
			meal('PUT', { date: MON, meal: 'lunch' }),
			meal('PUT', null),
			meal('PUT', { date: MON, meal: 'lunch', title: 'ignored' }, 'complete')
		]);
		expect(out).toEqual({ '2026-10-12|dinner': 'Pasta', '2026-10-14|snack': 'Apple' });
		expect(week['2026-10-13|lunch']).toBe('Rice');
	});

	it('a later set after a clear wins', () => {
		const out = overlayMeals(week, MON, [
			meal('DELETE', { date: MON, meal: 'dinner' }),
			meal('PUT', { date: MON, meal: 'dinner', title: 'Back' })
		]);
		expect(out['2026-10-12|dinner']).toBe('Back');
	});
});
