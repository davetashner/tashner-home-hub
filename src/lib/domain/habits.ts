/**
 * Habits (hub-esf): everyday checks that earn no stars on their own. Doing every habit due on a
 * day earns one star for that day, and each week shows how many of the due checks were done.
 * Pure rules; the server module reads chores, completions and routines into these shapes.
 */

/** Stars for finishing every habit due on one day. */
export const HABIT_DAY_STARS = 1;

/** Habit checks due on a day (routines count as one each) and how many are done. */
export interface HabitDay {
	due: number;
	done: number;
}

/** A day earns its star only when something was due and all of it is done. */
export const dayComplete = (d: HabitDay) => d.due > 0 && d.done >= d.due;

/** Ledger reference for a member's daily habit star: one row per member per day, ever. */
export const habitDayRef = (memberId: string, date: string) => `habits-day:${memberId}:${date}`;

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days of `date`'s week (Monday first) up to and including `date`. */
export function weekSoFar(date: string): string[] {
	const ms = toMs(date);
	const fromMonday = (new Date(ms).getUTCDay() + 6) % 7;
	return Array.from({ length: fromMonday + 1 }, (_, i) => fromMs(ms - (fromMonday - i) * DAY_MS));
}

/** Sums a run of days into one tally. */
export const tally = (days: HabitDay[]): HabitDay =>
	days.reduce((t, d) => ({ due: t.due + d.due, done: t.done + Math.min(d.done, d.due) }), {
		due: 0,
		done: 0
	});
