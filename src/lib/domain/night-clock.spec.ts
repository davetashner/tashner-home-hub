import { describe, expect, it } from 'vitest';
import {
	displayMode,
	nightClockOffset,
	parseDisplayMode,
	parseNightClockPatch,
	resolveNightClock
} from './night-clock.js';

describe('displayMode', () => {
	it('is normal whenever power is on', () => {
		for (const reason of ['schedule', 'wake', 'disabled'] as const)
			for (const nc of [true, false])
				expect(displayMode({ power: 'on', reason }, nc)).toBe('normal');
	});
	it('shows the night clock for a scheduled night when enabled', () => {
		expect(displayMode({ power: 'off', reason: 'schedule' }, true)).toBe('night-clock');
	});
	it('is off for a scheduled night when night clock is disabled', () => {
		expect(displayMode({ power: 'off', reason: 'schedule' }, false)).toBe('off');
	});
	it('stays off after Sleep now even with night clock enabled', () => {
		expect(displayMode({ power: 'off', reason: 'sleep-now' }, true)).toBe('off');
	});
});

describe('settings', () => {
	it('resolves only an explicit enabled:true', () => {
		expect(resolveNightClock({ enabled: true })).toBe(true);
		expect(resolveNightClock({ enabled: 'yes' })).toBe(false);
		expect(resolveNightClock(undefined)).toBe(false);
		expect(resolveNightClock(null)).toBe(false);
		expect(resolveNightClock(true)).toBe(false);
	});
	it('validates the patch', () => {
		expect(parseNightClockPatch({ enabled: false })).toBe(false);
		expect(parseNightClockPatch({ enabled: true })).toBe(true);
		expect(parseNightClockPatch({ enabled: 1 })).toMatch(/true or false/);
		expect(parseNightClockPatch({})).toMatch(/true or false/);
	});
	it('parses the mode field', () => {
		expect(parseDisplayMode('night-clock')).toBe('night-clock');
		expect(parseDisplayMode('off')).toBe('off');
		expect(parseDisplayMode('normal')).toBe('normal');
		expect(parseDisplayMode('x')).toBe('normal');
		expect(parseDisplayMode(undefined)).toBe('normal');
	});
});

describe('nightClockOffset', () => {
	it('stays within -1..1 and moves minute to minute', () => {
		const seen = new Set<string>();
		for (let m = 0; m < 600; m++) {
			const { x, y } = nightClockOffset(m * 60_000);
			expect(Math.abs(x)).toBeLessThanOrEqual(1);
			expect(Math.abs(y)).toBeLessThanOrEqual(1);
			seen.add(`${x},${y}`);
		}
		expect(seen.size).toBeGreaterThan(300);
	});
	it('holds still within a minute', () => {
		expect(nightClockOffset(5 * 60_000)).toEqual(nightClockOffset(5 * 60_000 + 59_999));
	});
});
