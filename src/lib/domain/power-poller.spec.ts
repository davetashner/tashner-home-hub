import { describe, expect, it } from 'vitest';
import { createPowerPoller, POWER_POLL_MS, type PowerSnapshot } from './power-poller';

function setup(initialBody: Record<string, unknown> = { power: 'on', mode: 'normal' }) {
	let body = initialBody;
	let t = 100;
	let hidden = false;
	let fetches = 0;
	let pending: (() => void) | null = null;
	let hold = false;
	const timers = new Map<number, { fn: () => void; ms: number }>();
	let nextId = 1;
	const changes: { snap: PowerSnapshot; changed: string[] }[] = [];
	const poller = createPowerPoller({
		fetch: async () => {
			fetches++;
			const answer = body;
			if (hold) await new Promise<void>((r) => (pending = r));
			return { ok: answer.ok !== false, json: async () => answer };
		},
		setTimeout: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { fn, ms });
			return id;
		},
		clearTimeout: (h) => void timers.delete(h as number),
		now: () => t,
		isHidden: () => hidden,
		onChange: (snap, changed) => changes.push({ snap, changed })
	});
	/** Fires the (single) pending timer and lets the fetch settle. */
	const tick = async () => {
		const [id, timer] = [...timers.entries()][0];
		timers.delete(id);
		timer.fn();
		await new Promise((r) => setTimeout(r, 0));
	};
	return {
		poller,
		timers,
		changes,
		tick,
		fetches: () => fetches,
		setBody: (b: Record<string, unknown>) => (body = b),
		setHidden: (h: boolean) => (hidden = h),
		advance: (ms: number) => (t += ms),
		hold: (h: boolean) => (hold = h),
		release: () => pending?.()
	};
}

describe('power poller', () => {
	it('polls once per tick through a single timer chain', async () => {
		const s = setup();
		s.poller.start();
		s.poller.start();
		expect(s.timers.size).toBe(1);
		await s.tick();
		expect(s.fetches()).toBe(1);
		expect([...s.timers.values()].map((t) => t.ms)).toEqual([POWER_POLL_MS]);
	});

	it('reports nothing while nothing changed, and only the fields that differ', async () => {
		const s = setup();
		s.poller.start();
		await s.tick();
		await s.tick();
		expect(s.changes).toEqual([]);
		s.setBody({ power: 'on', mode: 'normal', until: '2026-10-17T10:30:00.000Z' });
		await s.tick();
		expect(s.changes.map((c) => c.changed)).toEqual([['until']]);
		expect(s.poller.snapshot.changedAt).toBe(0);
		s.advance(5000);
		s.setBody({ power: 'off', reason: 'sleep-now', mode: 'off' });
		await s.tick();
		expect(s.changes[1].changed).toEqual(['power', 'mode', 'until', 'changedAt']);
		expect(s.poller.snapshot).toEqual({ power: 'off', mode: 'off', until: null, changedAt: 5100 });
	});

	it('treats night-clock as power on and unknown modes as normal', async () => {
		const s = setup({ power: 'on', mode: 'night-clock' });
		s.poller.start();
		await s.tick();
		expect(s.poller.snapshot).toMatchObject({ power: 'on', mode: 'night-clock' });
		s.setBody({ power: 'on', mode: 'weird' });
		await s.tick();
		expect(s.poller.snapshot.mode).toBe('normal');
	});

	it('keeps state on a failed or not-ok answer and keeps polling', async () => {
		const s = setup({ ok: false });
		s.poller.start();
		await s.tick();
		expect(s.changes).toEqual([]);
		expect(s.timers.size).toBe(1);
	});

	it('pauses while hidden and polls at once when visible again', async () => {
		const s = setup();
		s.poller.start();
		s.setHidden(true);
		s.poller.visibility();
		expect(s.timers.size).toBe(0);
		s.setHidden(false);
		s.poller.visibility();
		s.poller.visibility();
		expect(s.timers.size).toBe(1);
		await s.tick();
		expect(s.fetches()).toBe(1);
	});

	it('never has two fetches in flight and stops cleanly', async () => {
		const s = setup();
		s.hold(true);
		s.poller.start();
		const [id, t] = [...s.timers.entries()][0];
		s.timers.delete(id);
		t.fn();
		s.poller.visibility(); // in flight: must not start another
		expect(s.timers.size).toBe(0);
		expect(s.fetches()).toBe(1);
		s.poller.stop();
		s.release();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.timers.size).toBe(0);
	});

	it('an optimistic mode wins over an answer already in flight', async () => {
		const s = setup({ power: 'on', mode: 'night-clock' });
		s.hold(true);
		s.poller.start();
		const [id, t] = [...s.timers.entries()][0];
		s.timers.delete(id);
		t.fn();
		s.poller.setMode('normal');
		s.release();
		await new Promise((r) => setTimeout(r, 0));
		expect(s.poller.snapshot.mode).toBe('normal');
		expect(s.changes.every((c) => c.snap.mode === 'normal')).toBe(true);
	});
});
