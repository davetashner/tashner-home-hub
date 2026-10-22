/**
 * Seasonal looks for the wave background (hub-6pv.6): which holiday it is on the household's
 * calendar, and how many reindeer have joined Santa's team. Pure: no clock, no DOM.
 */
export const SEASONS = [
	'halloween',
	'autumn',
	'thanksgiving',
	'christmas',
	'christmasday',
	'stpatricks',
	'july4'
] as const;
export type Season = (typeof SEASONS)[number];

/** Santa's team, in the order they join from Dec 16 (Rudolph leads on Christmas Eve). */
export const REINDEER = [
	'Dasher',
	'Dancer',
	'Prancer',
	'Vixen',
	'Comet',
	'Cupid',
	'Donner',
	'Blitzen',
	'Rudolph'
] as const;

export interface SeasonState {
	season: Season | null;
	/** Reindeer on the team: 1 on Dec 16, one more each day, all 9 on Christmas Eve. */
	reindeer: number;
	/** Dec 24: snow, pines and Santa's sleigh. Christmas Day is its own season (tree, presents, fire). */
	christmasEve: boolean;
}

export const NO_SEASON: SeasonState = { season: null, reindeer: 0, christmasEve: false };

/** The first day of the countdown: one reindeer joins each day from here. */
const COUNTDOWN_START = 16;

/** The day of November US Thanksgiving falls on: the 4th Thursday. */
export function thanksgivingDay(year: number): number {
	const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
	return 1 + ((4 - firstDow + 7) % 7) + 21;
}

/**
 * Thanksgiving week (hub-6pv.6.9): the Sunday before Thanksgiving through the Sunday after,
 * eleven days in all. Always inside November, so it only ever overrides autumn.
 */
export function isThanksgivingWeek(year: number, month: number, day: number): boolean {
	if (month !== 11) return false;
	const tg = thanksgivingDay(year);
	return day >= tg - 4 && day <= tg + 3;
}

/**
 * The season for a calendar date (month 1-12). Thanksgiving week needs the year (the date moves);
 * without one, November is plain autumn.
 */
export function seasonForDate(month: number, day: number, year?: number): SeasonState {
	if (year !== undefined && isThanksgivingWeek(year, month, day)) {
		return { ...NO_SEASON, season: 'thanksgiving' };
	}
	if (month === 10 && day >= 26) return { ...NO_SEASON, season: 'halloween' };
	if (month === 11) return { ...NO_SEASON, season: 'autumn' };
	if (month === 12 && day === 25) return { ...NO_SEASON, season: 'christmasday' };
	if (month === 12 && day < 25) {
		const reindeer = day < COUNTDOWN_START ? 0 : day - COUNTDOWN_START + 1;
		return { season: 'christmas', reindeer, christmasEve: day === 24 };
	}
	if (month === 3 && day === 17) return { ...NO_SEASON, season: 'stpatricks' };
	if (month === 7 && day === 4) return { ...NO_SEASON, season: 'july4' };
	return NO_SEASON;
}

/** The season at `ms` on the household's calendar. An unknown zone falls back to UTC. */
export function seasonFor(ms: number, timeZone?: string): SeasonState {
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		}).formatToParts(new Date(ms));
	} catch {
		const d = new Date(ms);
		return seasonForDate(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear());
	}
	const get = (type: string) => Number(parts.find((x) => x.type === type)?.value);
	return seasonForDate(get('month'), get('day'), get('year'));
}

const isSeason = (v: string): v is Season => (SEASONS as readonly string[]).includes(v);

/**
 * A preview pin from the page URL: `?season=halloween`, `?season=christmas&reindeer=5`,
 * `?season=christmas-eve`, `?season=christmasday` or `?season=none`. Returns null when there is no (valid) pin, so the
 * calendar decides. Lives only in the URL: nothing is saved.
 */
export function parseSeasonOverride(search: Pick<URLSearchParams, 'get'>): SeasonState | null {
	const name = search.get('season');
	if (name === null) return null;
	if (name === 'none') return NO_SEASON;
	if (name === 'christmas-eve') {
		return { season: 'christmas', reindeer: REINDEER.length, christmasEve: true };
	}
	if (!isSeason(name)) return null;
	const n = Number(search.get('reindeer'));
	const reindeer =
		name === 'christmas' && Number.isInteger(n) ? Math.min(REINDEER.length, Math.max(0, n)) : 0;
	return { season: name, reindeer, christmasEve: false };
}

/** What to show now: a URL pin wins, otherwise the household calendar. */
export const currentSeason = (
	search: Pick<URLSearchParams, 'get'>,
	ms: number,
	timeZone?: string
) => parseSeasonOverride(search) ?? seasonFor(ms, timeZone);
