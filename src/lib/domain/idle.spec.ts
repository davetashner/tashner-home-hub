import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createIdleTimer,
	DEFAULT_IDLE,
	isIdleMinutes,
	parseIdleSettings,
	type IdleSettings
} from './idle.js';

const MIN = 60_000;

function setup(settings: IdleSettings = DEFAULT_IDLE, busy = false) {
	const calls: string[] = [];
	const state = { busy };
	const timer = createIdleTimer(settings, {
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
		isBusy: () => state.busy,
		goHome: () => calls.push('home'),
		startFrame: () => calls.push('frame'),
		endFrame: () => calls.push('end')
	});
	return { timer, calls, state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('parseIdleSettings', () => {
	it('defaults to home after 2 minutes and the frame after 5 (PHO-4)', () => {
		expect(parseIdleSettings({})).toEqual({ homeMinutes: 2, frameMinutes: 5 });
	});

	it('keeps valid values and replaces invalid ones', () => {
		expect(parseIdleSettings({ homeMinutes: 0, frameMinutes: 10 })).toEqual({
			homeMinutes: 0,
			frameMinutes: 10
		});
		expect(parseIdleSettings({ homeMinutes: -1, frameMinutes: 1.5 })).toEqual(DEFAULT_IDLE);
		expect(parseIdleSettings({ homeMinutes: '3', frameMinutes: 99_999 })).toEqual(DEFAULT_IDLE);
	});

	it('validates single values', () => {
		expect(isIdleMinutes(0)).toBe(true);
		expect(isIdleMinutes(1440)).toBe(true);
		expect(isIdleMinutes(1441)).toBe(false);
		expect(isIdleMinutes('2')).toBe(false);
		expect(isIdleMinutes(-1)).toBe(false);
	});
});

describe('createIdleTimer', () => {
	it('goes home, then starts the frame, counting from the last touch', () => {
		const { timer, calls } = setup();
		vi.advanceTimersByTime(2 * MIN - 1);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(calls).toEqual(['home']);
		expect(timer.phase).toBe('home');
		vi.advanceTimersByTime(3 * MIN - 1);
		expect(calls).toEqual(['home']);
		vi.advanceTimersByTime(1);
		expect(calls).toEqual(['home', 'frame']);
		expect(timer.phase).toBe('frame');
	});

	it('any touch resets the timers', () => {
		const { timer, calls } = setup();
		vi.advanceTimersByTime(MIN);
		timer.activity();
		vi.advanceTimersByTime(MIN + 30_000);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(30_000);
		expect(calls).toEqual(['home']);
		timer.activity();
		expect(timer.phase).toBe('active');
		vi.advanceTimersByTime(4 * MIN);
		expect(calls).toEqual(['home', 'home']);
	});

	it('a touch on the frame leaves it and starts over', () => {
		const { timer, calls } = setup();
		vi.advanceTimersByTime(5 * MIN);
		timer.activity();
		expect(calls).toEqual(['home', 'frame', 'end']);
		expect(timer.phase).toBe('active');
		vi.advanceTimersByTime(5 * MIN);
		expect(calls).toEqual(['home', 'frame', 'end', 'home', 'frame']);
	});

	it('waits one more period while someone is typing, then acts anyway', () => {
		const { calls, state } = setup(DEFAULT_IDLE, true);
		vi.advanceTimersByTime(2 * MIN);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(2 * MIN);
		expect(calls).toEqual(['home']);
		vi.advanceTimersByTime(3 * MIN);
		expect(calls).toEqual(['home', 'frame']);
		state.busy = false;
	});

	it('defers the frame once when busy and the home timer is off', () => {
		const { calls } = setup({ homeMinutes: 0, frameMinutes: 5 }, true);
		vi.advanceTimersByTime(5 * MIN);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(5 * MIN);
		expect(calls).toEqual(['frame']);
	});

	it('home only, when the frame is off', () => {
		const { calls } = setup({ homeMinutes: 2, frameMinutes: 0 });
		vi.advanceTimersByTime(60 * MIN);
		expect(calls).toEqual(['home']);
	});

	it('skips the home step when it would not come before the frame', () => {
		const { calls } = setup({ homeMinutes: 5, frameMinutes: 5 });
		vi.advanceTimersByTime(5 * MIN);
		expect(calls).toEqual(['frame']);
	});

	it('does nothing with both timers off', () => {
		const { timer, calls } = setup({ homeMinutes: 0, frameMinutes: 0 });
		timer.activity();
		vi.advanceTimersByTime(60 * MIN);
		expect(calls).toEqual([]);
	});

	it('stop cancels everything', () => {
		const { timer, calls } = setup();
		timer.stop();
		timer.stop();
		vi.advanceTimersByTime(60 * MIN);
		expect(calls).toEqual([]);
	});
});
