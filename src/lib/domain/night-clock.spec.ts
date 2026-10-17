import { describe, expect, it } from 'vitest';
import {
	displayMode,
	morningRange,
	nextMorningLine,
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

describe('nextMorningLine', () => {
	const ev = (title: string, startsAt: number, endsAt = startsAt + 3_600_000, allDay = false) => ({
		title,
		startsAt,
		endsAt,
		allDay
	});
	const zone = 'America/Chicago';
	// Tue 2026-10-20: now 02:07 CDT (07:07Z), waking 06:30 CDT (11:30Z).
	const now = Date.parse('2026-10-20T07:07:00Z');
	const wake = Date.parse('2026-10-20T11:30:00Z');
	const midnight = Date.parse('2026-10-20T05:00:00Z');

	it('is empty with no events', () => {
		expect(nextMorningLine([], wake, now, zone)).toBeNull();
	});
	it('picks the earliest timed event after waking and says Today after midnight', () => {
		const events = [ev('Dentist', wake + 4 * 3_600_000), ev('Swim practice', wake + 45 * 60_000)];
		expect(nextMorningLine(events, wake, now, zone)).toBe('Today 7:15 AM · Swim practice');
	});
	it('says Tomorrow before midnight and the weekday further out', () => {
		const evening = Date.parse('2026-10-20T03:00:00Z'); // Mon 22:00 CDT
		const events = [ev('Swim practice', wake + 45 * 60_000)];
		expect(nextMorningLine(events, wake, evening, zone)).toBe('Tomorrow 7:15 AM · Swim practice');
		expect(nextMorningLine(events, wake, evening - 2 * 86_400_000, zone)).toMatch(/^Tuesday 7:15/);
	});
	it('ignores events before waking, including ones crossing midnight into the morning', () => {
		const events = [
			ev('Early flight', wake - 3_600_000),
			ev('Late party', midnight - 3_600_000, wake - 3_600_000),
			ev('Sleepover', midnight - 7_200_000, wake + 3_600_000)
		];
		expect(nextMorningLine(events, wake, now, zone)).toBeNull();
	});
	it('ignores events that start after the wake-up day ends', () => {
		const nextDay = midnight + 86_400_000;
		expect(nextMorningLine([ev('Later', nextDay)], wake, now, zone)).toBeNull();
		expect(nextMorningLine([ev('Late show', nextDay - 1800_000)], wake, now, zone)).toBe(
			'Today 11:30 PM · Late show'
		);
	});
	it('prefers a timed event over an all-day one', () => {
		const day = Date.parse('2026-10-20T00:00:00Z');
		const events = [ev('School holiday', day, day + 86_400_000, true), ev('Swim', wake)];
		expect(nextMorningLine(events, wake, now, zone)).toBe('Today 6:30 AM · Swim');
	});
	it('names an all-day event when nothing is timed', () => {
		const day = Date.parse('2026-10-20T00:00:00Z');
		const events = [ev('School holiday', day, day + 86_400_000, true)];
		expect(nextMorningLine(events, wake, now, zone)).toBe('Today · School holiday');
	});
	it('matches multi-day and zero-length all-day events, not other days', () => {
		const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
		expect(
			nextMorningLine([ev('Camp', d('2026-10-19'), d('2026-10-22'), true)], wake, now, zone)
		).toBe('Today · Camp');
		expect(
			nextMorningLine([ev('Odd', d('2026-10-20'), d('2026-10-20'), true)], wake, now, zone)
		).toBe('Today · Odd');
		expect(
			nextMorningLine([ev('Over', d('2026-10-19'), d('2026-10-20'), true)], wake, now, zone)
		).toBeNull();
		expect(
			nextMorningLine([ev('Soon', d('2026-10-21'), d('2026-10-22'), true)], wake, now, zone)
		).toBeNull();
	});
	it('names untitled events', () => {
		expect(nextMorningLine([ev(' ', wake)], wake, now, zone)).toBe('Today 6:30 AM · Event');
	});
	it('handles the fall-back night (25 hour day)', () => {
		// Sun 2026-11-01: clocks fall back at 02:00 CDT. Wake 07:00 CST = 13:00Z.
		const w = Date.parse('2026-11-01T13:00:00Z');
		const n = Date.parse('2026-11-01T05:30:00Z'); // 00:30 CDT
		const range = morningRange(w, zone);
		expect(range.end - range.start).toBe(25 * 3_600_000);
		expect(nextMorningLine([ev('Church', w + 3_600_000)], w, n, zone)).toBe(
			'Today 8:00 AM · Church'
		);
	});
	it('handles the spring-forward night (23 hour day)', () => {
		// Sun 2027-03-14: clocks spring forward at 02:00 CST. Wake 07:00 CDT = 12:00Z.
		const w = Date.parse('2027-03-14T12:00:00Z');
		const n = Date.parse('2027-03-14T05:30:00Z'); // Sat 23:30 CST
		const range = morningRange(w, zone);
		expect(range.end - range.start).toBe(23 * 3_600_000);
		expect(nextMorningLine([ev('Brunch', w + 3_600_000)], w, n, zone)).toBe(
			'Tomorrow 8:00 AM · Brunch'
		);
	});
});
