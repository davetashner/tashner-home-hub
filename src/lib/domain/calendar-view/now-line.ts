import { offsetAt, type DateKey } from './zone.js';
import type { CalEvent } from './layout.js';

/**
 * Wall-clock minutes since local midnight on `key` at instant `now` in `timeZone`
 * (fractional). Matches the grid's wall-clock axis, so the line stays aligned on DST days.
 * Negative before the day starts, above 1440 after it ends.
 */
export function minutesIntoDay(now: number, key: DateKey, timeZone: string): number {
	const [y, m, d] = key.split('-').map(Number);
	const wallNow = now + offsetAt(now, timeZone);
	return (wallNow - Date.UTC(y, m - 1, d)) / 60_000;
}

/**
 * Minute of the day (in the household zone) at which to draw the current-time line in a
 * time grid showing `hours` (from inclusive, to exclusive), or null when `key` is not
 * today's grid column or now falls outside the visible hours.
 */
export function nowLineMinute(
	now: number,
	key: DateKey,
	today: DateKey,
	timeZone: string,
	hours: { from: number; to: number }
): number | null {
	if (key !== today) return null;
	const min = minutesIntoDay(now, key, timeZone);
	return min >= hours.from * 60 && min <= hours.to * 60 ? min : null;
}

/**
 * Where the "now" divider goes in a day's agenda list (sorted all-day first, then by start):
 * the index of the first timed event that has not started yet, or the list length when all
 * have. All-day events never move the divider.
 */
export function agendaNowIndex(list: CalEvent[], now: number): number {
	const i = list.findIndex((ev) => !ev.allDay && ev.startsAt > now);
	return i === -1 ? list.length : i;
}
