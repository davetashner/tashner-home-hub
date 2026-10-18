import { describe, expect, it, vi } from 'vitest';
import { BACKOFF_MAX_MS, backoffDelay, createLiveChannel, type SourceLike } from './live-events.js';

function fake() {
	const made: (SourceLike & { fire(type: string, data: string): void; closed: boolean })[] = [];
	const create = (url: string) => {
		const handlers: Record<string, (e: { data: string }) => void> = {};
		const s = {
			url,
			readyState: 0,
			closed: false,
			onopen: null as ((ev: never) => unknown) | null,
			onerror: null as ((ev: never) => unknown) | null,
			addEventListener: (t: string, fn: (e: { data: string }) => void) => (handlers[t] = fn),
			close() {
				s.closed = true;
				s.readyState = 2;
			},
			fire: (t: string, d: string) => handlers[t]?.({ data: d })
		};
		made.push(s);
		return s;
	};
	const timers: { fn: () => void; ms: number; id: number }[] = [];
	let next = 1;
	const setTimer = (fn: () => void, ms: number) => {
		timers.push({ fn, ms, id: next });
		return next++;
	};
	const clearTimer = (id: unknown) => {
		const i = timers.findIndex((t) => t.id === id);
		if (i >= 0) timers.splice(i, 1);
	};
	return { made, create, timers, setTimer, clearTimer };
}

describe('backoffDelay', () => {
	it('doubles and caps', () => {
		expect([0, 1, 2, 3].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000]);
		expect(backoffDelay(20)).toBe(BACKOFF_MAX_MS);
		expect(backoffDelay(-3)).toBe(1000);
	});
});

describe('createLiveChannel', () => {
	const setup = () => {
		const f = fake();
		const onEvent = vi.fn();
		const onOpen = vi.fn();
		const onStatus = vi.fn();
		const ch = createLiveChannel({
			url: '/api/events',
			topics: ['lists'],
			create: f.create,
			onEvent,
			onOpen,
			onStatus,
			setTimer: f.setTimer,
			clearTimer: f.clearTimer
		});
		return { f, ch, onEvent, onOpen, onStatus };
	};

	it('opens with the topics, reports status and parses events', () => {
		const { f, ch, onEvent, onOpen, onStatus } = setup();
		ch.start();
		expect(f.made).toHaveLength(1);
		f.made[0].onopen?.(undefined as never);
		expect(onOpen).toHaveBeenCalledOnce();
		expect(onStatus).toHaveBeenLastCalledWith(true);
		f.made[0].fire('lists', '{"listId":"a"}');
		expect(onEvent).toHaveBeenCalledWith('lists', { listId: 'a' });
		f.made[0].fire('lists', 'not json');
		expect(onEvent).toHaveBeenLastCalledWith('lists', {});
	});

	it('leaves a connecting browser retry alone', () => {
		const { f, ch, onStatus } = setup();
		ch.start();
		f.made[0].readyState = 0;
		f.made[0].onerror?.(undefined as never);
		expect(onStatus).toHaveBeenLastCalledWith(false);
		expect(f.timers).toHaveLength(0);
	});

	it('reconnects with growing backoff after the browser gives up, and resets on open', () => {
		const { f, ch } = setup();
		ch.start();
		f.made[0].onerror?.(undefined as never);
		f.made[0].readyState = 2;
		f.made[0].onerror?.(undefined as never);
		expect(f.timers.map((t) => t.ms)).toEqual([1000]);
		f.timers.shift()?.fn();
		expect(f.made).toHaveLength(2);
		f.made[1].readyState = 2;
		f.made[1].onerror?.(undefined as never);
		expect(f.timers[0].ms).toBe(2000);
		f.timers.shift()?.fn();
		f.made[2].onopen?.(undefined as never);
		f.made[2].readyState = 2;
		f.made[2].onerror?.(undefined as never);
		expect(f.timers[0].ms).toBe(1000);
	});

	it('does not stack retry timers', () => {
		const { f, ch } = setup();
		ch.start();
		f.made[0].readyState = 2;
		f.made[0].onerror?.(undefined as never);
		f.made[0].onerror?.(undefined as never);
		expect(f.timers).toHaveLength(1);
	});

	it('resume reopens only a dead connection', () => {
		const { f, ch } = setup();
		ch.resume();
		expect(f.made).toHaveLength(0);
		ch.start();
		f.made[0].readyState = 1;
		ch.resume();
		expect(f.made).toHaveLength(1);
		f.made[0].readyState = 2;
		f.made[0].onerror?.(undefined as never);
		ch.resume();
		expect(f.made).toHaveLength(2);
		expect(f.timers).toHaveLength(0);
	});

	it('stop closes, cancels the retry and ignores later timers', () => {
		const { f, ch, onStatus } = setup();
		ch.start();
		f.made[0].readyState = 2;
		f.made[0].onerror?.(undefined as never);
		ch.stop();
		expect(f.timers).toHaveLength(0);
		expect(onStatus).toHaveBeenLastCalledWith(false);
		ch.start();
		ch.stop();
		expect(f.made[1].closed).toBe(true);
	});
});
