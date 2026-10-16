import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SLEEP_SCHEDULE as D,
	applySleepPatch,
	displayPower,
	nightEndingOn,
	parseSleepPatch,
	resolveSleepSchedule,
	zonedInstant,
	type SleepSchedule
} from './display-power.js';

const NY = 'America/New_York';
const at = (y: number, m: number, d: number, hhmm: string, zone = NY) =>
	zonedInstant(zone, y, m, d, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const T = (y: number, m: number, d: number, hhmm: string) => at(y, m, d, hhmm);
const iso = (ms: number) => new Date(ms).toISOString();

// 2026-10-16 is a Friday; 10-17 Saturday; 10-18 Sunday; 10-19 Monday.
const weekend: SleepSchedule = {
	...D,
	weekday: { sleep: '21:30', wake: '06:30' },
	weekend: { sleep: '23:00', wake: '08:00' }
};

describe('zonedInstant', () => {
	it('reads wall time in the zone', () => {
		expect(iso(T(2026, 10, 16, '21:30'))).toBe('2026-10-17T01:30:00.000Z');
		expect(iso(T(2026, 12, 1, '06:30'))).toBe('2026-12-01T11:30:00.000Z');
	});
	it('maps a skipped spring-forward time to the same instant as the hour after', () => {
		expect(at(2026, 3, 8, '02:30')).toBe(at(2026, 3, 8, '03:30'));
	});
	it('takes the first occurrence of a repeated fall-back time', () => {
		expect(iso(at(2026, 11, 1, '01:30'))).toBe('2026-11-01T05:30:00.000Z');
	});
});

describe('schedule', () => {
	it('is on in the day and reports when it next sleeps', () => {
		const r = displayPower(T(2026, 10, 14, '12:00'), NY, D);
		expect(r).toEqual({ power: 'on', reason: 'schedule', until: iso(T(2026, 10, 14, '21:30')) });
	});
	it('is off across midnight until the wake time', () => {
		for (const [d, hhmm] of [
			[14, '22:00'],
			[15, '03:00']
		] as const) {
			expect(displayPower(T(2026, 10, d, hhmm), NY, D)).toEqual({
				power: 'off',
				reason: 'schedule',
				until: iso(T(2026, 10, 15, '06:30'))
			});
		}
	});
	it('switches exactly on the boundaries', () => {
		expect(displayPower(T(2026, 10, 14, '21:30'), NY, D).power).toBe('off');
		expect(displayPower(T(2026, 10, 14, '21:29'), NY, D).power).toBe('on');
		expect(displayPower(T(2026, 10, 15, '06:30'), NY, D).power).toBe('on');
	});
	it('handles a window that starts after midnight', () => {
		const s = { ...D, weekday: { sleep: '01:00', wake: '07:00' } };
		expect(displayPower(T(2026, 10, 14, '00:30'), NY, s).power).toBe('on');
		expect(displayPower(T(2026, 10, 14, '03:00'), NY, s)).toMatchObject({
			power: 'off',
			until: iso(T(2026, 10, 14, '07:00'))
		});
		expect(displayPower(T(2026, 10, 14, '12:00'), NY, s).until).toBe(iso(T(2026, 10, 15, '01:00')));
	});
	it('never sleeps when sleep and wake are the same time', () => {
		const s = { ...D, weekday: { sleep: '07:00', wake: '07:00' }, weekend: D.weekend };
		expect(nightEndingOn(s, NY, { y: 2026, m: 10, d: 14 })).toBeNull();
		expect(displayPower(T(2026, 10, 14, '23:00'), NY, s).power).toBe('on');
	});
	it('stays on when disabled, whatever the hour', () => {
		expect(displayPower(T(2026, 10, 14, '23:00'), NY, { ...D, enabled: false })).toEqual({
			power: 'on',
			reason: 'disabled'
		});
	});
});

describe('weekday and weekend nights', () => {
	it('uses the weekend schedule for Friday and Saturday bedtimes', () => {
		// Fri 22:00 is still awake (weekend bedtime 23:00); Fri 23:30 is off until Sat 08:00.
		expect(displayPower(T(2026, 10, 16, '22:00'), NY, weekend).power).toBe('on');
		expect(displayPower(T(2026, 10, 16, '23:30'), NY, weekend)).toMatchObject({
			power: 'off',
			until: iso(T(2026, 10, 17, '08:00'))
		});
		expect(displayPower(T(2026, 10, 17, '07:00'), NY, weekend).power).toBe('off');
		expect(displayPower(T(2026, 10, 17, '23:30'), NY, weekend).until).toBe(
			iso(T(2026, 10, 18, '08:00'))
		);
	});
	it('uses the weekday schedule for Sunday bedtime and Friday morning', () => {
		expect(displayPower(T(2026, 10, 18, '22:00'), NY, weekend)).toMatchObject({
			power: 'off',
			until: iso(T(2026, 10, 19, '06:30'))
		});
		expect(displayPower(T(2026, 10, 16, '07:00'), NY, weekend).power).toBe('on');
		// Thursday night -> Friday morning is a weekday night, even though Friday is near.
		expect(displayPower(T(2026, 10, 16, '06:00'), NY, weekend).power).toBe('off');
	});
});

describe('daylight saving', () => {
	it('keeps the wall-clock bedtime across spring forward (Mar 8 2026)', () => {
		// Night of Sat Mar 7 -> Sun Mar 8 is 9 hours long in real time.
		const r = displayPower(at(2026, 3, 8, '01:00'), NY, D);
		expect(r).toMatchObject({ power: 'off', until: iso(at(2026, 3, 8, '06:30')) });
		expect(iso(at(2026, 3, 8, '06:30'))).toBe('2026-03-08T10:30:00.000Z');
		expect(displayPower(at(2026, 3, 8, '06:30'), NY, D).power).toBe('on');
	});
	it('keeps the wall-clock bedtime across fall back (Nov 1 2026)', () => {
		const r = displayPower(at(2026, 11, 1, '03:00'), NY, D);
		expect(r).toMatchObject({ power: 'off', until: '2026-11-01T11:30:00.000Z' });
		expect(displayPower(Date.parse('2026-11-01T11:29:00Z'), NY, D).power).toBe('off');
		expect(displayPower(Date.parse('2026-11-01T11:30:00Z'), NY, D).power).toBe('on');
	});
});

describe('sleep now', () => {
	it('turns off in the day and stays off until the next scheduled wake', () => {
		const sleepNowAt = T(2026, 10, 14, '15:00');
		const wakeUp = iso(T(2026, 10, 15, '06:30'));
		expect(displayPower(T(2026, 10, 14, '15:00'), NY, D, { sleepNowAt })).toEqual({
			power: 'off',
			reason: 'sleep-now',
			until: wakeUp
		});
		expect(displayPower(T(2026, 10, 14, '23:00'), NY, D, { sleepNowAt })).toMatchObject({
			power: 'off',
			reason: 'sleep-now'
		});
		// After the wake time the schedule governs again.
		expect(displayPower(T(2026, 10, 15, '06:30'), NY, D, { sleepNowAt })).toMatchObject({
			power: 'on',
			reason: 'schedule'
		});
	});
	it('during the night ends at that night’s wake time', () => {
		const sleepNowAt = T(2026, 10, 14, '23:00');
		expect(displayPower(T(2026, 10, 15, '01:00'), NY, D, { sleepNowAt })).toMatchObject({
			reason: 'sleep-now',
			until: iso(T(2026, 10, 15, '06:30'))
		});
	});
	it('with the schedule disabled lasts until a touch', () => {
		const s = { ...D, enabled: false };
		const sleepNowAt = T(2026, 10, 14, '15:00');
		expect(displayPower(T(2026, 10, 20, '15:00'), NY, s, { sleepNowAt })).toEqual({
			power: 'off',
			reason: 'sleep-now'
		});
		expect(
			displayPower(T(2026, 10, 20, '15:00'), NY, s, {
				sleepNowAt,
				wakeAt: T(2026, 10, 15, '9:00'.padStart(5, '0'))
			})
		).toEqual({ power: 'on', reason: 'disabled' });
	});
	it('a touch after it turns the screen back on (daytime)', () => {
		const events = { sleepNowAt: T(2026, 10, 14, '15:00'), wakeAt: T(2026, 10, 14, '15:05') };
		expect(displayPower(T(2026, 10, 14, '15:06'), NY, D, events)).toEqual({
			power: 'on',
			reason: 'schedule',
			until: iso(T(2026, 10, 14, '21:30'))
		});
	});
	it('sleep now again after a touch wins (newest event)', () => {
		const events = { wakeAt: T(2026, 10, 14, '15:00'), sleepNowAt: T(2026, 10, 14, '15:05') };
		expect(displayPower(T(2026, 10, 14, '15:06'), NY, D, events).reason).toBe('sleep-now');
	});
	it('ignores an event stamped in the future', () => {
		const sleepNowAt = T(2026, 10, 14, '16:00');
		expect(displayPower(T(2026, 10, 14, '15:00'), NY, D, { sleepNowAt }).power).toBe('on');
	});
});

describe('touch to wake', () => {
	const wakeAt = T(2026, 10, 14, '23:00');
	it('stays on for the timeout at night, then sleeps again until morning', () => {
		expect(displayPower(wakeAt, NY, D, { wakeAt })).toEqual({
			power: 'on',
			reason: 'wake',
			until: iso(wakeAt + 2 * 60_000)
		});
		expect(displayPower(wakeAt + 119_000, NY, D, { wakeAt }).power).toBe('on');
		expect(displayPower(wakeAt + 120_000, NY, D, { wakeAt })).toEqual({
			power: 'off',
			reason: 'schedule',
			until: iso(T(2026, 10, 15, '06:30'))
		});
	});
	it('uses the configured timeout', () => {
		const s = { ...D, resleepMinutes: 10 };
		expect(displayPower(wakeAt + 9 * 60_000, NY, s, { wakeAt }).power).toBe('on');
		expect(displayPower(wakeAt + 10 * 60_000, NY, s, { wakeAt }).power).toBe('off');
	});
	it('does not outlast the end of the night', () => {
		const late = T(2026, 10, 15, '06:29');
		expect(displayPower(late, NY, D, { wakeAt: late })).toMatchObject({
			reason: 'wake',
			until: iso(T(2026, 10, 15, '06:30'))
		});
		expect(displayPower(T(2026, 10, 15, '06:31'), NY, D, { wakeAt: late })).toMatchObject({
			power: 'on',
			reason: 'schedule'
		});
	});
	it('a touch during the day changes nothing', () => {
		const day = T(2026, 10, 14, '12:00');
		expect(displayPower(day + 60_000, NY, D, { wakeAt: day })).toEqual({
			power: 'on',
			reason: 'schedule',
			until: iso(T(2026, 10, 14, '21:30'))
		});
	});
	it('an old daytime touch does not keep a later night awake', () => {
		const day = T(2026, 10, 14, '21:29');
		expect(displayPower(T(2026, 10, 14, '21:31'), NY, D, { wakeAt: day }).power).toBe('off');
	});
	it('a night-time touch does not leak into the next night', () => {
		expect(displayPower(T(2026, 10, 15, '23:00'), NY, D, { wakeAt }).reason).toBe('schedule');
	});
});

describe('stored values', () => {
	it('falls back field by field', () => {
		expect(resolveSleepSchedule(undefined)).toEqual(D);
		expect(
			resolveSleepSchedule({
				enabled: false,
				weekday: { sleep: 'x', wake: '05:00' },
				resleepMinutes: 0
			})
		).toEqual({ ...D, enabled: false, weekday: { sleep: '21:30', wake: '05:00' } });
		expect(resolveSleepSchedule('junk')).toEqual(D);
	});
	it('validates and applies patches', () => {
		expect(parseSleepPatch({ enabled: 'yes' })).toMatch(/enabled/);
		expect(parseSleepPatch({ weekdaySleep: '25:00' })).toMatch(/weekdaySleep/);
		expect(parseSleepPatch({ weekendWake: '7:00' })).toMatch(/weekendWake/);
		expect(parseSleepPatch({ resleepMinutes: 0 })).toMatch(/resleepMinutes/);
		expect(parseSleepPatch({ resleepMinutes: 1.5 })).toMatch(/resleepMinutes/);
		const patch = parseSleepPatch({
			enabled: false,
			weekendSleep: '23:30',
			resleepMinutes: 5,
			x: 1
		});
		expect(patch).toEqual({ enabled: false, weekendSleep: '23:30', resleepMinutes: 5 });
		expect(applySleepPatch(D, patch as object)).toEqual({
			enabled: false,
			weekday: D.weekday,
			weekend: { sleep: '23:30', wake: '06:30' },
			resleepMinutes: 5
		});
	});
});
