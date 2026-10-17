/**
 * Countdowns (requirements CD-1): "12 days to the beach trip" on the home screen.
 * Pure: a countdown is a title plus a calendar day (`YYYY-MM-DD`) in the household time zone,
 * and "today" is whatever that zone says, never the browser's or the container's zone.
 */

export interface CountdownLike {
	id: string;
	title: string;
	/** Local calendar day, YYYY-MM-DD. */
	targetDate: string;
	icon: string | null;
}

export const COUNTDOWN_TITLE_MAX = 60;
/** How many countdowns the home screen shows. */
export const HOME_COUNTDOWN_LIMIT = 3;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for a `YYYY-MM-DD` string, or null when it is not a real calendar day. */
export function dayNumber(date: string): number | null {
	const m = DATE_RE.exec(date);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const ms = Date.UTC(y, mo - 1, d);
	const back = new Date(ms);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
		return null;
	return ms / 86_400_000;
}

export const isCalendarDate = (v: unknown): v is string =>
	typeof v === 'string' && dayNumber(v) !== null;

/** The calendar day `now` falls on in `timeZone`. */
export function dayIn(now: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(now));
}

/** Whole calendar days from `today` to `target` (0 = today, negative = past); null if invalid. */
export function daysUntil(target: string, today: string): number | null {
	const a = dayNumber(target);
	const b = dayNumber(today);
	return a === null || b === null ? null : a - b;
}

/** "Today", "Tomorrow", "12 days". */
export function countdownLabel(days: number): string {
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	return `${days} days`;
}

export interface CountdownView extends CountdownLike {
	days: number;
	label: string;
}

/** Countdowns still to come (today included), soonest first, capped at `limit`. */
export function upcomingCountdowns(
	list: readonly CountdownLike[],
	today: string,
	limit = HOME_COUNTDOWN_LIMIT
): CountdownView[] {
	const out: CountdownView[] = [];
	for (const c of list) {
		const days = daysUntil(c.targetDate, today);
		if (days === null || days < 0) continue;
		out.push({ ...c, days, label: countdownLabel(days) });
	}
	return out
		.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title))
		.slice(0, Math.max(0, limit));
}
