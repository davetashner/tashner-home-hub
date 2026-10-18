/**
 * Flexible to-dos (hub-it5): done once per week or per two weeks, on any day the kid picks.
 *
 * Stored as `DTSTART:…` + `RRULE:FREQ=WEEKLY;INTERVAL=n` plus an `X-HUB-FLEX:1` line, so the rule
 * still reads as a plain weekly RRULE elsewhere. Periods are Monday-to-Sunday weeks (the same weeks
 * as the weekly summary), counted from the week holding the start day. A to-do is open until it is
 * checked off once in its period; it is never carried into the next period.
 */
import { addDays } from '#lib/domain/streaks.js';

export const FLEX_MARK = 'X-HUB-FLEX:1';
export type FlexEvery = 1 | 2;

export interface FlexPeriod {
	/** First day (a Monday) and last day (a Sunday) of the period, YYYY-MM-DD. */
	start: string;
	end: string;
	/** Which week of the period `date` falls in (1 or 2), and how many weeks the period has. */
	week: number;
	weeks: FlexEvery;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** The Monday on or before a YYYY-MM-DD day. */
export function mondayOf(date: string): string {
	const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
	return addDays(date, -((dow + 6) % 7));
}

/** The period holding `date`, or null before the schedule starts. */
export function flexPeriod(start: string, every: FlexEvery, date: string): FlexPeriod | null {
	if (date < start) return null;
	const first = mondayOf(start);
	const weeksIn = Math.round((dayNumber(mondayOf(date)) - dayNumber(first)) / 7);
	const index = Math.floor(weeksIn / every);
	const periodStart = addDays(first, index * every * 7);
	return {
		start: periodStart,
		end: addDays(periodStart, every * 7 - 1),
		week: (weeksIn % every) + 1,
		weeks: every
	};
}

/** Reads stored schedule text: the start day and period length of a flexible to-do, else null. */
export function flexOf(
	text: string | null,
	fallback: string
): { start: string; every: FlexEvery } | null {
	if (!text?.includes(FLEX_MARK)) return null;
	const m = /DTSTART:(\d{4})(\d{2})(\d{2})T/.exec(text);
	const every = /INTERVAL=2\b/.test(text) ? 2 : 1;
	return { start: m ? `${m[1]}-${m[2]}-${m[3]}` : fallback, every };
}
