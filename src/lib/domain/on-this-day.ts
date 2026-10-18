/**
 * "On this day" (PHO-11): favour photos taken near today's month and day in past years.
 * Pure so the frame only wires the result into its playlist.
 */

export const ON_THIS_DAY_MODES = ['off', 'favor', 'only'] as const;
export type OnThisDayMode = (typeof ON_THIS_DAY_MODES)[number];

export function isOnThisDayMode(v: unknown): v is OnThisDayMode {
	return typeof v === 'string' && (ON_THIS_DAY_MODES as readonly string[]).includes(v);
}

/** Photos within this many days of today's month/day (either side) count. */
export const WINDOW_DAYS = 3;
/** "Only" falls back to every photo when fewer than this many match. */
export const MIN_ONLY_MATCHES = 10;
/** "Favor" repeats matches to hold the share only when at least this many exist. */
export const MIN_FAVOR_REPEAT = 5;
/** One slide in this many is a match while "favor" has matches to give. */
export const FAVOR_EVERY = 3;

export interface CalendarDay {
	year: number;
	/** 1-12. */
	month: number;
	day: number;
}

const DAY_MS = 86_400_000;

/** Today's date on the viewing screen's own clock. */
export function calendarDay(now: Date): CalendarDay {
	return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The server stores EXIF local time read as UTC, so UTC fields are the photographer's clock. */
function takenDay(takenAt: number): CalendarDay {
	const d = new Date(takenAt);
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isLeap(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Midnight UTC of month/day in `year`; a Feb 29 anniversary in a common year lands on Feb 28. */
function anniversary(year: number, month: number, day: number): number {
	const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day;
	return Date.UTC(year, month - 1, d);
}

export interface OnThisDayMatch {
	/** Whole years between the photo and the anniversary it matched (always >= 1). */
	yearsAgo: number;
	/** Days between that anniversary and today (0 to WINDOW_DAYS). */
	daysAway: number;
}

/**
 * Whether a photo was taken within `window` days of today's month/day in an earlier year. The
 * distance runs across year ends (Jan 1 is 2 days from Dec 30) and Feb 29 counts as Feb 28 in
 * common years. A photo from this year, or the future, never matches.
 */
export function onThisDayMatch(
	takenAt: number | null | undefined,
	today: CalendarDay,
	window = WINDOW_DAYS
): OnThisDayMatch | null {
	if (typeof takenAt !== 'number' || !Number.isFinite(takenAt)) return null;
	const taken = takenDay(takenAt);
	const todayMs = Date.UTC(today.year, today.month - 1, today.day);
	let best: OnThisDayMatch | null = null;
	for (const year of [today.year - 1, today.year, today.year + 1]) {
		const daysAway = Math.round(
			Math.abs(anniversary(year, taken.month, taken.day) - todayMs) / DAY_MS
		);
		const yearsAgo = year - taken.year;
		if (daysAway > window || yearsAgo < 1) continue;
		if (!best || daysAway < best.daysAway) best = { yearsAgo, daysAway };
	}
	return best;
}

/** "3 years ago today", or "this week" when the anniversary is a few days off. */
export function onThisDayCaption(
	takenAt: number | null | undefined,
	today: CalendarDay,
	window = WINDOW_DAYS
): string | null {
	const m = onThisDayMatch(takenAt, today, window);
	if (!m) return null;
	const years = m.yearsAgo === 1 ? '1 year' : `${m.yearsAgo} years`;
	return `${years} ago ${m.daysAway === 0 ? 'today' : 'this week'}`;
}

/**
 * Puts `matches` into `others` so that every `every`-th slide is a match. With enough matches
 * (MIN_FAVOR_REPEAT) they cycle to hold that share to the end of the pass; with fewer each shows
 * once. The leftover others follow. Order within each input is kept.
 */
export function weave<T>(matches: readonly T[], others: readonly T[], every = FAVOR_EVERY): T[] {
	if (matches.length === 0) return [...others];
	if (others.length === 0) return [...matches];
	const out: T[] = [];
	const perOther = every - 1;
	const repeat = matches.length >= MIN_FAVOR_REPEAT;
	let m = 0;
	let o = 0;
	let sinceMatch = 0;
	while (o < others.length) {
		if (sinceMatch >= perOther && (repeat || m < matches.length)) {
			out.push(matches[m % matches.length]);
			m++;
			sinceMatch = 0;
		} else {
			out.push(others[o++]);
			sinceMatch++;
		}
	}
	// Without repeats, matches not yet placed close the pass.
	if (!repeat) while (m < matches.length) out.push(matches[m++]);
	return out;
}

/** The playlist for one pass: `shuffle` mixes each group, then the mode decides the blend. */
export function arrangePlaylist<T extends { takenAt?: number | null }>(
	photos: readonly T[],
	mode: OnThisDayMode,
	today: CalendarDay,
	shuffle: (items: readonly T[]) => T[]
): T[] {
	if (mode === 'off') return shuffle(photos);
	const matches: T[] = [];
	const others: T[] = [];
	for (const p of photos) (onThisDayMatch(p.takenAt, today) ? matches : others).push(p);
	if (mode === 'only') return shuffle(matches.length >= MIN_ONLY_MATCHES ? matches : photos);
	return weave(shuffle(matches), shuffle(others));
}
