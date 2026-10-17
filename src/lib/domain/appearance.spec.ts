import { describe, expect, it } from 'vitest';
import {
	DEFAULT_APPEARANCE,
	FRAME_DIM_FLOOR,
	SUNSET_DELAY_MS,
	appearanceAt,
	applyAppearancePatch,
	dimFactor,
	isEveningNow,
	parseAppearancePatch,
	resolveAppearance,
	themeFor
} from './appearance.js';
import { DEFAULT_SLEEP_SCHEDULE, zonedInstant, type SleepSchedule } from './display-power.js';
import { parseLocation, sunTimes } from './sun.js';

const MIN = 60_000;
const NY = 'America/New_York';
const nyc = { lat: 40.7128, lon: -74.006 };
const schedule: SleepSchedule = {
	...DEFAULT_SLEEP_SCHEDULE,
	weekend: { sleep: '22:00', wake: '08:00' }
};
/** The instant New York's wall clock reads y-m-d h:m. */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	zonedInstant(NY, y, m, d, h * 60 + min);
const evening = (now: number, loc = null as ReturnType<typeof parseLocation>, start = '19:00') =>
	isEveningNow(now, NY, { eveningStart: start }, schedule, loc);

describe('sun times', () => {
	it('matches published New York times for the June solstice', () => {
		const s = sunTimes(nyc, 2024, 6, 21);
		expect(Math.abs(s.sunrise! - at(2024, 6, 21, 5, 25)) / MIN).toBeLessThanOrEqual(2);
		expect(Math.abs(s.sunset! - at(2024, 6, 21, 20, 31)) / MIN).toBeLessThanOrEqual(2);
	});
	it('reports polar day and night, and parses locations', () => {
		const tromso = { lat: 69.6492, lon: 18.9553 };
		expect(sunTimes(tromso, 2024, 6, 21).polar).toBe('day');
		expect(sunTimes(tromso, 2024, 12, 21).polar).toBe('night');
		expect(parseLocation({ lat: 1, lon: 2, name: 'x' })).toEqual({ lat: 1, lon: 2 });
		for (const bad of [null, 'x', { lat: '1', lon: 2 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }])
			expect(parseLocation(bad)).toBeNull();
	});
});

describe('evening without a location', () => {
	it('starts at the evening time (the minute before and after)', () => {
		expect(evening(at(2024, 6, 18, 12))).toBe(false);
		expect(evening(at(2024, 6, 18, 18, 59))).toBe(false);
		expect(evening(at(2024, 6, 18, 19))).toBe(true);
		expect(evening(at(2024, 6, 18, 23, 59))).toBe(true);
	});
	it('ends at the weekday wake time', () => {
		expect(evening(at(2024, 6, 19, 0, 0))).toBe(true);
		expect(evening(at(2024, 6, 19, 6, 29))).toBe(true);
		expect(evening(at(2024, 6, 19, 6, 30))).toBe(false);
		expect(evening(at(2024, 6, 19, 6, 31))).toBe(false);
	});
	it('uses the weekend wake time on a weekend morning', () => {
		// Saturday 2024-06-22 wakes at 08:00; Friday evening still starts at 19:00.
		expect(evening(at(2024, 6, 21, 18, 59))).toBe(false);
		expect(evening(at(2024, 6, 21, 19))).toBe(true);
		expect(evening(at(2024, 6, 22, 7, 59))).toBe(true);
		expect(evening(at(2024, 6, 22, 8))).toBe(false);
	});
	it('follows a configured evening time', () => {
		expect(evening(at(2024, 6, 18, 20, 29), null, '20:30')).toBe(false);
		expect(evening(at(2024, 6, 18, 20, 30), null, '20:30')).toBe(true);
	});
	it('holds across the spring-forward night', () => {
		// 2024-03-10 (Sunday, weekend wake 08:00): 02:00-03:00 does not exist.
		expect(evening(at(2024, 3, 9, 19))).toBe(true);
		expect(evening(at(2024, 3, 10, 3, 30))).toBe(true);
		expect(evening(at(2024, 3, 10, 7, 59))).toBe(true);
		expect(evening(at(2024, 3, 10, 8))).toBe(false);
		expect(evening(at(2024, 3, 10, 18, 59))).toBe(false);
		expect(evening(at(2024, 3, 10, 19))).toBe(true);
	});
	it('holds across the fall-back night', () => {
		// 2024-11-03: 01:00-02:00 happens twice.
		const first = zonedInstant(NY, 2024, 11, 3, 90);
		expect(evening(first)).toBe(true);
		expect(evening(first + 60 * MIN)).toBe(true);
		expect(evening(at(2024, 11, 3, 7, 59))).toBe(true);
		expect(evening(at(2024, 11, 3, 8))).toBe(false);
		expect(evening(at(2024, 11, 3, 18, 59))).toBe(false);
		expect(evening(at(2024, 11, 3, 19))).toBe(true);
	});
});

describe('evening with a location', () => {
	const sun = sunTimes(nyc, 2024, 6, 21);
	const start = sun.sunset! + SUNSET_DELAY_MS;
	it('starts 45 minutes after sunset', () => {
		expect(evening(start - MIN, nyc)).toBe(false);
		expect(evening(start, nyc)).toBe(true);
		expect(evening(start + MIN, nyc)).toBe(true);
		// Not the 19:00 fallback: it is still light at 19:00 in June.
		expect(evening(at(2024, 6, 21, 19, 30), nyc)).toBe(false);
	});
	it('ends at sunrise, not the wake time', () => {
		const rise = sunTimes(nyc, 2024, 6, 22).sunrise!;
		expect(evening(rise - MIN, nyc)).toBe(true);
		expect(evening(rise, nyc)).toBe(false);
		expect(evening(rise + MIN, nyc)).toBe(false);
	});
	it('is right on DST change days', () => {
		const spring = sunTimes(nyc, 2024, 3, 10).sunset! + SUNSET_DELAY_MS;
		expect(evening(spring - MIN, nyc)).toBe(false);
		expect(evening(spring, nyc)).toBe(true);
		const fall = sunTimes(nyc, 2024, 11, 3).sunset! + SUNSET_DELAY_MS;
		expect(evening(fall - MIN, nyc)).toBe(false);
		expect(evening(fall, nyc)).toBe(true);
	});
	it('treats polar night as all evening and polar day as none', () => {
		const tromso = { lat: 69.6492, lon: 18.9553 };
		const oslo = 'Europe/Oslo';
		const probe = (iso: string) =>
			isEveningNow(Date.parse(iso), oslo, DEFAULT_APPEARANCE, schedule, tromso);
		expect(probe('2024-12-21T12:00:00Z')).toBe(true);
		expect(probe('2024-06-21T22:00:00Z')).toBe(false);
	});
});

describe('theme and dimming', () => {
	it('picks the theme from the choice', () => {
		expect(themeFor('light', true)).toBe('light');
		expect(themeFor('dark', false)).toBe('night');
		expect(themeFor('auto', false)).toBe('light');
		expect(themeFor('auto', true)).toBe('night');
	});
	it('dims only the wall display in the evening, with a floor for the photo frame', () => {
		const a = { dim: 0.6 };
		expect(dimFactor(a, true, true)).toBe(0.6);
		expect(dimFactor(a, false, true)).toBe(1);
		expect(dimFactor(a, true, false)).toBe(1);
		expect(dimFactor(a, true, true, true)).toBe(FRAME_DIM_FLOOR);
		expect(dimFactor({ dim: 0.95 }, true, true, true)).toBe(0.95);
		expect(dimFactor({ dim: null }, true, true)).toBe(1);
	});
	it('combines both for a moment', () => {
		const a = DEFAULT_APPEARANCE;
		const noon = appearanceAt(at(2024, 6, 18, 12), NY, a, schedule, null, true);
		expect(noon).toEqual({ theme: 'light', dim: 1 });
		const night = appearanceAt(at(2024, 6, 18, 21), NY, a, schedule, null, true);
		expect(night).toEqual({ theme: 'night', dim: 0.8 });
		expect(appearanceAt(at(2024, 6, 18, 21), NY, a, schedule, null, false).dim).toBe(1);
	});
});

describe('stored settings', () => {
	it('falls back field by field', () => {
		expect(resolveAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
		expect(resolveAppearance({ theme: 'x', eveningStart: '08:00', dim: 0.1 })).toEqual(
			DEFAULT_APPEARANCE
		);
		expect(resolveAppearance({ theme: 'dark', eveningStart: '21:15', dim: null })).toEqual({
			theme: 'dark',
			eveningStart: '21:15',
			dim: null
		});
	});
	it('validates patches', () => {
		expect(parseAppearancePatch({ theme: 'dark', dim: null, eveningStart: '12:00', x: 1 })).toEqual(
			{ theme: 'dark', dim: null, eveningStart: '12:00' }
		);
		expect(parseAppearancePatch({ dim: 0.5 })).toEqual({ dim: 0.5 });
		expect(parseAppearancePatch({ dim: 1 })).toEqual({ dim: 1 });
		for (const bad of [{ theme: 'neon' }, { dim: 0.49 }, { dim: 1.1 }, { dim: '0.8' }])
			expect(typeof parseAppearancePatch(bad)).toBe('string');
		expect(typeof parseAppearancePatch({ eveningStart: '11:59' })).toBe('string');
		expect(typeof parseAppearancePatch({ eveningStart: '24:00' })).toBe('string');
		expect(applyAppearancePatch(DEFAULT_APPEARANCE, { dim: null }).dim).toBeNull();
	});
});
