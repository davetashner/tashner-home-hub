import { describe, expect, it, vi } from 'vitest';
import { createLongPress, exceedsSlop } from './longpress.js';
import { detectSwipe } from './swipe.js';

function harness(options = {}) {
	let now = 0;
	let pending: { at: number; fn: () => void } | null = null;
	const timers = {
		setTimeout: (fn: () => void, ms: number) => (pending = { at: now + ms, fn }),
		clearTimeout: (h: unknown) => {
			if (pending === h) pending = null;
		}
	};
	const fired = vi.fn();
	const press = createLongPress(fired, options, timers);
	const wait = (ms: number) => {
		now += ms;
		if (pending && pending.at <= now) {
			const { fn } = pending;
			pending = null;
			fn();
		}
	};
	return { press, fired, wait };
}

describe('exceedsSlop', () => {
	it('measures straight-line travel', () => {
		expect(exceedsSlop(6, 8, 10)).toBe(false);
		expect(exceedsSlop(8, 8, 10)).toBe(true);
		expect(exceedsSlop(-11, 0, 10)).toBe(true);
	});
});

describe('createLongPress', () => {
	it('fires once after the delay when held still', () => {
		const { press, fired, wait } = harness();
		press.start(10, 10);
		wait(599);
		expect(fired).not.toHaveBeenCalled();
		wait(1);
		expect(fired).toHaveBeenCalledTimes(1);
		wait(2000);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it('treats undefined options as defaults', () => {
		const { press, fired, wait } = harness({ delayMs: undefined, slop: undefined });
		press.start(0, 0);
		wait(599);
		expect(fired).not.toHaveBeenCalled();
		wait(1);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it('tolerates jitter within the slop', () => {
		const { press, fired, wait } = harness();
		press.start(100, 100);
		press.move(104, 103);
		wait(600);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it('cancels when the pointer travels past the slop', () => {
		const { press, fired, wait } = harness();
		press.start(100, 100);
		press.move(100, 115);
		wait(1000);
		expect(fired).not.toHaveBeenCalled();
		expect(press.end()).toBe(false);
	});

	it('does not fire when released early (a tap)', () => {
		const { press, fired, wait } = harness();
		press.start(0, 0);
		wait(200);
		expect(press.end()).toBe(false);
		wait(1000);
		expect(fired).not.toHaveBeenCalled();
	});

	it('reports a fired press on release so the click can be swallowed, once', () => {
		const { press, wait } = harness();
		press.start(0, 0);
		wait(600);
		expect(press.end()).toBe(true);
		expect(press.end()).toBe(false);
	});

	it('ignores movement after firing and when no press is active', () => {
		const { press, fired, wait } = harness();
		press.move(500, 500);
		press.start(0, 0);
		wait(600);
		press.move(500, 500);
		expect(fired).toHaveBeenCalledTimes(1);
		expect(press.end()).toBe(true);
	});

	it('cancel stops a pending press; a new start restarts the clock', () => {
		const { press, fired, wait } = harness({ delayMs: 300 });
		press.start(0, 0);
		press.cancel();
		wait(400);
		expect(fired).not.toHaveBeenCalled();
		press.start(0, 0);
		wait(200);
		press.start(0, 0);
		wait(200);
		expect(fired).not.toHaveBeenCalled();
		wait(100);
		expect(fired).toHaveBeenCalledTimes(1);
		press.cancel();
		expect(press.end()).toBe(false);
	});

	it('counts a release that arrives after the delay but before the late timer ran', () => {
		let clock = 0;
		const timers = { setTimeout: () => 1, clearTimeout: () => undefined, now: () => clock };
		const fired = vi.fn();
		const press = createLongPress(fired, { delayMs: 600 }, timers);
		press.start(0, 0);
		clock = 599;
		expect(press.end()).toBe(false);
		expect(fired).not.toHaveBeenCalled();
		press.start(0, 0);
		clock = 1300;
		expect(press.end()).toBe(true);
		expect(fired).toHaveBeenCalledTimes(1);
		press.start(0, 0);
		clock = 2000;
		press.move(50, 0);
		clock = 2700;
		expect(press.end()).toBe(false);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it('works with the real timers by default', () => {
		vi.useFakeTimers();
		const fired = vi.fn();
		const press = createLongPress(fired, { delayMs: 50 });
		press.start(0, 0);
		vi.advanceTimersByTime(50);
		expect(fired).toHaveBeenCalledTimes(1);
		press.start(0, 0);
		press.cancel();
		vi.advanceTimersByTime(100);
		expect(fired).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it('never overlaps a swipe: anything long-press cancels past its slop is short of swipe range or already cancelled', () => {
		// A held press has moved <= slop (10px), below the swipe minimum (24px).
		expect(detectSwipe(10, 0, 700)).toBeNull();
		const { press, fired, wait } = harness();
		press.start(0, 0);
		press.move(80, 0);
		wait(700);
		expect(fired).not.toHaveBeenCalled();
		expect(detectSwipe(80, 0, 700)).toBe('right');
	});
});
