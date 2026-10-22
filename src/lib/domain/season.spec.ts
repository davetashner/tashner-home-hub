import { describe, expect, it } from 'vitest';
import {
	currentSeason,
	NO_SEASON,
	parseSeasonOverride,
	REINDEER,
	seasonFor,
	seasonForDate,
	thanksgivingDay
} from './season.js';

const q = (s: string) => new URLSearchParams(s);

describe('seasonForDate', () => {
	it('starts Halloween five days early and ends it on the 31st', () => {
		expect(seasonForDate(10, 25)).toEqual(NO_SEASON);
		expect(seasonForDate(10, 26).season).toBe('halloween');
		expect(seasonForDate(10, 31).season).toBe('halloween');
	});
	it('is autumn for all of November', () => {
		expect(seasonForDate(11, 1).season).toBe('autumn');
		expect(seasonForDate(11, 30).season).toBe('autumn');
	});
	it('finds the 4th Thursday of November', () => {
		expect(thanksgivingDay(2026)).toBe(26);
		expect(thanksgivingDay(2027)).toBe(25);
		expect(thanksgivingDay(2028)).toBe(23);
		// The earliest (Nov 22) and latest (Nov 28) it can fall.
		expect(thanksgivingDay(2018)).toBe(22);
		expect(thanksgivingDay(2012)).toBe(22);
		expect(thanksgivingDay(2019)).toBe(28);
	});
	it.each([
		[2026, 22, 29],
		[2027, 21, 28],
		[2028, 19, 26]
	])('Thanksgiving week %i runs Nov %i to Nov %i, Sunday to Sunday', (year, first, last) => {
		expect(new Date(Date.UTC(year, 10, first)).getUTCDay()).toBe(0);
		expect(new Date(Date.UTC(year, 10, last)).getUTCDay()).toBe(0);
		expect(seasonForDate(11, first - 1, year).season).toBe('autumn');
		for (let day = first; day <= last; day++) {
			expect(seasonForDate(11, day, year)).toEqual({ ...NO_SEASON, season: 'thanksgiving' });
		}
		expect(seasonForDate(11, last + 1, year).season).toBe('autumn');
	});
	it('keeps the rest of November autumn, and needs a year for the week', () => {
		expect(seasonForDate(11, 1, 2026).season).toBe('autumn');
		expect(seasonForDate(11, 30, 2026).season).toBe('autumn');
		expect(seasonForDate(11, 26).season).toBe('autumn');
		expect(seasonForDate(10, 26, 2026).season).toBe('halloween');
		expect(seasonForDate(12, 1, 2026).season).toBe('christmas');
	});
	it('is Christmas from Dec 1 to Christmas Eve, with no reindeer until the 16th', () => {
		expect(seasonForDate(12, 1)).toEqual({ season: 'christmas', reindeer: 0, christmasEve: false });
		expect(seasonForDate(12, 15).reindeer).toBe(0);
	});
	it('adds one reindeer a day from Dec 16, all nine by Christmas Eve', () => {
		for (let day = 16; day <= 24; day++) {
			expect(seasonForDate(12, day).reindeer).toBe(day - 15);
		}
		expect(seasonForDate(12, 24)).toEqual({ season: 'christmas', reindeer: 9, christmasEve: true });
		expect(seasonForDate(12, 23).christmasEve).toBe(false);
		expect(REINDEER).toHaveLength(9);
		expect(REINDEER.at(-1)).toBe('Rudolph');
	});
	it('gives Christmas Day its own scene with no reindeer', () => {
		expect(seasonForDate(12, 25)).toEqual({
			season: 'christmasday',
			reindeer: 0,
			christmasEve: false
		});
		expect(seasonForDate(12, 26)).toEqual(NO_SEASON);
	});
	it("is St. Patrick's Day on March 17 only", () => {
		expect(seasonForDate(3, 16)).toEqual(NO_SEASON);
		expect(seasonForDate(3, 17).season).toBe('stpatricks');
		expect(seasonForDate(3, 18)).toEqual(NO_SEASON);
	});
	it('is the Fourth of July on July 4 only', () => {
		expect(seasonForDate(7, 3)).toEqual(NO_SEASON);
		expect(seasonForDate(7, 4).season).toBe('july4');
		expect(seasonForDate(7, 5)).toEqual(NO_SEASON);
	});
	it('is nothing on an ordinary day', () => {
		expect(seasonForDate(5, 9)).toEqual(NO_SEASON);
	});
});

describe('seasonFor', () => {
	// 2026-10-26 02:00 UTC is still Oct 25 in New York.
	const lateOct25NewYork = Date.UTC(2026, 9, 26, 2);
	it("follows the household's calendar, not UTC", () => {
		expect(seasonFor(lateOct25NewYork, 'America/New_York')).toEqual(NO_SEASON);
		expect(seasonFor(lateOct25NewYork, 'UTC').season).toBe('halloween');
	});
	it("uses the household's calendar for Thanksgiving week", () => {
		// 2026-11-22 03:00 UTC is still Sat Nov 21 in New York.
		const sunMorningUtc = Date.UTC(2026, 10, 22, 3);
		expect(seasonFor(sunMorningUtc, 'America/New_York').season).toBe('autumn');
		expect(seasonFor(sunMorningUtc, 'UTC').season).toBe('thanksgiving');
		// 2026-11-30 03:00 UTC is Sun Nov 29 evening in New York: the last day of the week.
		const monUtc = Date.UTC(2026, 10, 30, 3);
		expect(seasonFor(monUtc, 'America/New_York').season).toBe('thanksgiving');
		expect(seasonFor(monUtc, 'UTC').season).toBe('autumn');
		expect(seasonFor(Date.UTC(2026, 10, 26, 17), 'America/New_York').season).toBe('thanksgiving');
	});
	it('falls back to UTC for an unknown zone', () => {
		expect(seasonFor(lateOct25NewYork, 'Not/AZone').season).toBe('halloween');
	});
	it('uses the runtime zone when none is given', () => {
		expect(seasonFor(Date.UTC(2026, 10, 15, 12)).season).toBe('autumn');
	});
});

describe('parseSeasonOverride', () => {
	it('is null without a pin or with an unknown one', () => {
		expect(parseSeasonOverride(q(''))).toBeNull();
		expect(parseSeasonOverride(q('season=easter'))).toBeNull();
	});
	it('pins a season, and none pins no season', () => {
		expect(parseSeasonOverride(q('season=halloween'))).toEqual({
			season: 'halloween',
			reindeer: 0,
			christmasEve: false
		});
		expect(parseSeasonOverride(q('season=christmasday'))?.season).toBe('christmasday');
		expect(parseSeasonOverride(q('season=july4'))?.season).toBe('july4');
		expect(parseSeasonOverride(q('season=thanksgiving'))?.season).toBe('thanksgiving');
		expect(parseSeasonOverride(q('season=none'))).toEqual(NO_SEASON);
	});
	it('takes a reindeer count for Christmas only, clamped to the team', () => {
		expect(parseSeasonOverride(q('season=christmas&reindeer=5'))?.reindeer).toBe(5);
		expect(parseSeasonOverride(q('season=christmas&reindeer=40'))?.reindeer).toBe(9);
		expect(parseSeasonOverride(q('season=christmas&reindeer=-2'))?.reindeer).toBe(0);
		expect(parseSeasonOverride(q('season=christmas&reindeer=2.5'))?.reindeer).toBe(0);
		expect(parseSeasonOverride(q('season=autumn&reindeer=5'))?.reindeer).toBe(0);
	});
	it('pins Christmas Eve with the whole team', () => {
		expect(parseSeasonOverride(q('season=christmas-eve'))).toEqual({
			season: 'christmas',
			reindeer: 9,
			christmasEve: true
		});
	});
});

describe('currentSeason', () => {
	const midJuly = Date.UTC(2026, 6, 15, 12);
	it('lets a pin win over the calendar', () => {
		expect(currentSeason(q('season=stpatricks'), midJuly, 'UTC').season).toBe('stpatricks');
		expect(currentSeason(q(''), Date.UTC(2026, 2, 17, 12), 'UTC').season).toBe('stpatricks');
		expect(currentSeason(q(''), midJuly, 'UTC')).toEqual(NO_SEASON);
	});
});

describe('birthday season (synthetic dates)', () => {
	const ymd = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 17);
	const at = (y: number, m: number, d: number, list: { month: number; day: number }[]) =>
		seasonFor(ymd(y, m, d), 'UTC', list).season;

	it('shows on the birthday and not the day before or after', () => {
		const list = [{ month: 3, day: 14 }];
		expect(at(2030, 3, 14, list)).toBe('birthday');
		expect(at(2031, 3, 14, list)).toBe('birthday');
		expect(at(2030, 3, 13, list)).toBeNull();
		expect(at(2030, 3, 15, list)).toBeNull();
	});
	it('overrides the Christmas palette in December', () => {
		const list = [{ month: 12, day: 20 }];
		expect(at(2030, 12, 20, list)).toBe('birthday');
		expect(seasonFor(ymd(2030, 12, 20), 'UTC', list).reindeer).toBe(0);
		expect(at(2030, 12, 19, list)).toBe('christmas');
		expect(at(2030, 12, 21, list)).toBe('christmas');
		expect(at(2030, 12, 25, [{ month: 12, day: 25 }])).toBe('birthday');
	});
	it('overrides Thanksgiving week and leaves its edges alone', () => {
		// Thanksgiving 2030 is Nov 28; its week runs Nov 24 to Dec 1.
		const list = [{ month: 11, day: 26 }];
		expect(at(2030, 11, 26, list)).toBe('birthday');
		expect(at(2030, 11, 25, list)).toBe('thanksgiving');
		expect(at(2030, 11, 27, list)).toBe('thanksgiving');
		expect(at(2030, 11, 22, list)).toBe('autumn');
	});
	it('puts a Feb 29 birthday on Feb 28 in a non-leap year, and on Feb 29 in a leap year', () => {
		const list = [{ month: 2, day: 29 }];
		expect(at(2030, 2, 28, list)).toBe('birthday');
		expect(at(2030, 3, 1, list)).toBeNull();
		expect(at(2032, 2, 28, list)).toBeNull();
		expect(at(2032, 2, 29, list)).toBe('birthday');
	});
	it('uses the household zone for the date', () => {
		const list = [{ month: 3, day: 14 }];
		const ms = Date.UTC(2030, 2, 14, 2, 0); // Mar 14 02:00 UTC is still Mar 13 in New York
		expect(seasonFor(ms, 'UTC', list).season).toBe('birthday');
		expect(seasonFor(ms, 'America/New_York', list).season).toBeNull();
	});
	it('can be pinned for a preview', () => {
		expect(parseSeasonOverride(q('season=birthday'))?.season).toBe('birthday');
		expect(currentSeason(q('season=birthday'), ymd(2030, 6, 1), 'UTC', []).season).toBe('birthday');
	});
});
