import {
	addDays,
	addMonths,
	dayStartMs,
	daysBetween,
	firstOfMonth,
	range,
	startOfWeek,
	type DateKey
} from './zone.js';

export type CalendarViewMode = 'agenda' | 'week' | 'month';

export const VIEW_MODES: readonly CalendarViewMode[] = ['agenda', 'week', 'month'];
export const AGENDA_DAYS = 7;

export function isViewMode(v: unknown): v is CalendarViewMode {
	return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

/** The local days a view shows for an anchor day (month: whole weeks covering the month). */
export function periodKeys(view: CalendarViewMode, anchor: DateKey, weekStartsOn = 0): DateKey[] {
	if (view === 'agenda') return range(anchor, AGENDA_DAYS);
	if (view === 'week') return range(startOfWeek(anchor, weekStartsOn), 7);
	const first = firstOfMonth(anchor);
	const gridStart = startOfWeek(first, weekStartsOn);
	const next = addMonths(first, 1);
	const weeks = Math.ceil(daysBetween(gridStart, next) / 7);
	return range(gridStart, weeks * 7);
}

/** Move an anchor by one period. */
export function shiftAnchor(view: CalendarViewMode, anchor: DateKey, dir: 1 | -1): DateKey {
	if (view === 'month') return addMonths(anchor, dir);
	return addDays(anchor, dir * 7);
}

/**
 * The instant range to request for a period. Padded by a day each side so
 * all-day events (stored at UTC midnight) are never missed in any zone.
 */
export function fetchRange(keys: DateKey[], timeZone: string): { start: number; end: number } {
	return {
		start: dayStartMs(addDays(keys[0], -1), timeZone),
		end: dayStartMs(addDays(keys[keys.length - 1], 2), timeZone)
	};
}
