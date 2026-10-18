import { describe, expect, it } from 'vitest';
import {
	addTime,
	cleanLabel,
	doneMessage,
	firedTimers,
	formatRemaining,
	isFired,
	isRunning,
	isTimerDuration,
	pauseTimer,
	remainingMs,
	resumeTimer,
	sortTimers,
	startTimer,
	MAX_TIMER_MS,
	MINUTE_MS
} from './timers.js';

const T0 = 1_000_000;

describe('startTimer', () => {
	it('computes endsAt from now and cleans the label', () => {
		const t = startTimer('a', 5 * MINUTE_MS, '  Pasta ', T0);
		expect(t).toEqual({
			id: 'a',
			label: 'Pasta',
			durationMs: 300_000,
			endsAt: T0 + 300_000,
			pausedMs: null
		});
		expect(isRunning(t)).toBe(true);
	});
	it('clamps the length', () => {
		expect(startTimer('a', 5, null, T0).durationMs).toBe(1000);
		expect(startTimer('a', 1e12, null, T0).durationMs).toBe(MAX_TIMER_MS);
	});
});

describe('remaining and fired', () => {
	const t = startTimer('a', 60_000, null, T0);
	it('counts down from endsAt', () => {
		expect(remainingMs(t, T0 + 20_000)).toBe(40_000);
		expect(isFired(t, T0 + 59_999)).toBe(false);
	});
	it('fires at endsAt and never goes negative', () => {
		expect(isFired(t, T0 + 60_000)).toBe(true);
		expect(remainingMs(t, T0 + 90_000)).toBe(0);
	});
	it('a paused timer never fires', () => {
		const p = pauseTimer(t, T0 + 10_000);
		expect(isFired(p, T0 + 999_999)).toBe(false);
		expect(remainingMs(p, T0 + 999_999)).toBe(50_000);
	});
});

describe('pause and resume', () => {
	const t = startTimer('a', 60_000, null, T0);
	it('keeps the time left across a pause', () => {
		const p = pauseTimer(t, T0 + 15_000);
		expect(p).toMatchObject({ endsAt: null, pausedMs: 45_000 });
		const r = resumeTimer(p, T0 + 100_000);
		expect(r).toMatchObject({ endsAt: T0 + 145_000, pausedMs: null });
	});
	it('ignores a pause of a paused or fired timer and a resume of a running one', () => {
		const p = pauseTimer(t, T0 + 1000);
		expect(pauseTimer(p, T0 + 2000)).toBe(p);
		expect(pauseTimer(t, T0 + 70_000)).toBe(t);
		expect(resumeTimer(t, T0 + 1000)).toBe(t);
	});
});

describe('addTime', () => {
	const t = startTimer('a', 60_000, null, T0);
	it('extends a running timer', () => {
		const a = addTime(t, MINUTE_MS, T0 + 10_000);
		expect(a.endsAt).toBe(T0 + 120_000);
		expect(a.durationMs).toBe(120_000);
	});
	it('extends a paused timer', () => {
		const p = pauseTimer(t, T0 + 10_000);
		expect(addTime(p, MINUTE_MS, T0 + 20_000)).toMatchObject({ pausedMs: 110_000, endsAt: null });
	});
	it('restarts a fired timer from now', () => {
		const a = addTime(t, MINUTE_MS, T0 + 90_000);
		expect(a.endsAt).toBe(T0 + 150_000);
		expect(isFired(a, T0 + 90_000)).toBe(false);
	});
	it('stays within the maximum', () => {
		const big = startTimer('b', MAX_TIMER_MS, null, T0);
		expect(addTime(big, MINUTE_MS, T0).endsAt).toBe(T0 + MAX_TIMER_MS);
	});
});

describe('helpers', () => {
	it('validates durations and labels', () => {
		expect(isTimerDuration(1000)).toBe(true);
		expect(isTimerDuration(999)).toBe(false);
		expect(isTimerDuration(1.5e3 + 0.5)).toBe(false);
		expect(isTimerDuration('5')).toBe(false);
		expect(cleanLabel('   ')).toBeNull();
		expect(cleanLabel(3)).toBeNull();
		expect(cleanLabel('x'.repeat(40))).toHaveLength(20);
	});
	it('formats remaining time rounded up', () => {
		expect(formatRemaining(245_000)).toBe('4:05');
		expect(formatRemaining(200)).toBe('0:01');
		expect(formatRemaining(0)).toBe('0:00');
		expect(formatRemaining(-5)).toBe('0:00');
		expect(formatRemaining(3_723_000)).toBe('1:02:03');
	});
	it('words the banner', () => {
		expect(doneMessage(startTimer('a', 1000, 'Pasta', T0))).toBe('Pasta is done');
		expect(doneMessage(startTimer('a', 1000, null, T0))).toBe('Timer is done');
	});
	it('sorts soonest first with paused last, and finds fired ones', () => {
		const a = startTimer('a', 300_000, null, T0);
		const b = startTimer('b', 60_000, null, T0);
		const c = pauseTimer(startTimer('c', 10_000, null, T0), T0);
		expect(sortTimers([c, a, b], T0).map((t) => t.id)).toEqual(['b', 'a', 'c']);
		expect(firedTimers([a, b, c], T0 + 100_000).map((t) => t.id)).toEqual(['b']);
	});
});
