import { describe, expect, it } from 'vitest';
import {
	currentSeason,
	NO_SEASON,
	parseSeasonOverride,
	REINDEER,
	seasonFor,
	seasonForDate
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
