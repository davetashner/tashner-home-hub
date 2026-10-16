import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { createChore } = await import('#lib/server/domain/ledger.js');
const complete = await import('./chores/[id]/complete/+server.js');
const approve = await import('./completions/[id]/approve/+server.js');
const reject = await import('./completions/[id]/reject/+server.js');
const undo = await import('./completions/[id]/undo/+server.js');
const approvals = await import('./approvals/+server.js');
const recent = await import('./completions/+server.js');
const stars = await import('./members/[id]/stars/+server.js');
const bonus = await import('./members/[id]/bonus/+server.js');

const post = (body?: unknown) =>
	new Request('http://example.com/x', {
		method: 'POST',
		body: body === undefined ? undefined : JSON.stringify(body)
	});
// Handlers only use a subset of RequestEvent; cast for direct invocation.
// Requests are made by an unlocked adult unless the event sets `locals` itself.
const call = (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: { id: 'adult', name: 'Test Adult' } },
		...ev
	});

describe('star ledger API', () => {
	it('complete -> approvals -> approve -> stars', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid', name: 'Test Child', role: 'child', color: 'blue' })
			.run();
		const chore = createChore(db, { title: 'Dishes', stars: 2 });

		const res = await call(complete.POST, {
			params: { id: chore.id },
			request: post({ memberId: 'kid' })
		});
		const { completion, created } = await res.json();
		expect(created).toBe(true);
		expect(completion.status).toBe('pending');

		const list = await (await call(approvals.GET, {})).json();
		expect(list).toHaveLength(1);

		await call(approve.POST, { params: { id: completion.id } });
		const s = await (
			await call(stars.GET, {
				params: { id: 'kid' },
				url: new URL('http://example.com/?limit=10')
			})
		).json();
		expect(s).toMatchObject({ balance: 2, pending: 0 });
		expect(s.history).toHaveLength(1);
	});

	it('maps errors and validates input', async () => {
		await expect(
			call(complete.POST, { params: { id: 'nope' }, request: post({ memberId: 'kid' }) })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			call(complete.POST, { params: { id: 'x' }, request: post({}) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(complete.POST, { params: { id: 'x' }, request: post({ memberId: 'k', date: 'bad' }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(complete.POST, {
				params: { id: 'x' },
				request: new Request('http://example.com', { method: 'POST', body: '[' })
			})
		).rejects.toMatchObject({ status: 400 });
		await expect(
			call(bonus.POST, { params: { id: 'kid' }, request: post({ delta: 'a', note: 'n' }) })
		).rejects.toMatchObject({ status: 400 });
	});

	it('reject, undo, bonus and explicit date', async () => {
		const db = getDb();
		const chore = createChore(db, { title: 'Toys' });
		const { completion } = await (
			await call(complete.POST, {
				params: { id: chore.id },
				request: post({ memberId: 'kid', date: '2026-02-01' })
			})
		).json();
		const rej = await call(reject.POST, {
			params: { id: completion.id },
			request: post({ note: 'redo' })
		});
		expect((await rej.json()).status).toBe('rejected');

		const { completion: c2 } = await (
			await call(complete.POST, {
				params: { id: chore.id },
				request: post({ memberId: 'kid', date: '2026-02-01' })
			})
		).json();
		const u = await call(undo.POST, { params: { id: c2.id } });
		expect((await u.json()).status).toBe('undone');

		// reject with an empty body is allowed
		const { completion: c3 } = await (
			await call(complete.POST, { params: { id: chore.id }, request: post({ memberId: 'kid' }) })
		).json();
		const empty = await call(reject.POST, {
			params: { id: c3.id },
			request: new Request('http://example.com', {
				method: 'POST',
				headers: { 'content-length': '0' }
			})
		});
		expect(empty.status).toBe(200);

		const b = await call(bonus.POST, {
			params: { id: 'kid' },
			request: post({ delta: 3, note: 'great' })
		});
		expect((await b.json()).reason).toBe('bonus');
		const s = await (
			await call(stars.GET, {
				params: { id: 'kid' },
				url: new URL('http://example.com/?limit=x&before=y')
			})
		).json();
		expect(s.balance).toBe(5);
	});

	it('lists recent approved completions so an adult can undo one later', async () => {
		const db = getDb();
		db.insert(schema.members)
			.values({ id: 'kid2', name: 'Test Child Two', role: 'child', color: 'blue' })
			.run();
		const chore = createChore(db, { title: 'Fish', stars: 3, requiresApproval: false });
		const { completion } = await (
			await call(complete.POST, { params: { id: chore.id }, request: post({ memberId: 'kid2' }) })
		).json();
		const mine = async (days: string) =>
			(
				(await (
					await call(recent.GET, { url: new URL(`http://example.com/?days=${days}`) })
				).json()) as { memberId: string; completionId: string }[]
			).filter((r) => r.memberId === 'kid2');
		for (const days of ['3', 'x', '999'])
			expect(await mine(days)).toMatchObject([{ completionId: completion.id }]);
		const u = await call(undo.POST, { params: { id: completion.id } });
		expect((await u.json()).status).toBe('undone');
		expect(await mine('7')).toEqual([]);
	});

	it('adult-only routes reject callers without an adult session', async () => {
		const locals = { adult: null };
		const params = { id: 'x' };
		const request = post({ delta: 1, note: 'n' });
		for (const [handler, ev] of [
			[approvals.GET, {}],
			[recent.GET, { url: new URL('http://example.com/') }],
			[approve.POST, { params }],
			[reject.POST, { params, request }],
			[bonus.POST, { params, request }]
		] as const) {
			await expect((async () => call(handler, { ...ev, locals }))()).rejects.toMatchObject({
				status: 401
			});
		}
	});
});
