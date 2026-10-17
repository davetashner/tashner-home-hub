/** Weekly meal plan rules (requirements MEAL-1): slots, text limits and Monday-based week math. */
import { addDays, range, startOfWeek, type DateKey } from '#lib/domain/calendar-view/zone.js';
import { dayIn, isCalendarDate } from '#lib/domain/countdowns.js';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MEAL_TEXT_MAX = 100;

export const isMealSlot = (v: unknown): v is MealSlot =>
	typeof v === 'string' && (MEAL_SLOTS as readonly string[]).includes(v);

/** Trimmed meal text, or null when it is empty or too long. */
export function cleanMealText(v: unknown): string | null {
	const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
	return t.length >= 1 && t.length <= MEAL_TEXT_MAX ? t : null;
}

/** The Monday on or before a day. */
export const mondayOf = (day: DateKey): DateKey => startOfWeek(day, 1);

/** Monday through Sunday for the week holding `day`. */
export const weekDays = (day: DateKey): DateKey[] => range(mondayOf(day), 7);

export const shiftWeek = (day: DateKey, dir: 1 | -1): DateKey => addDays(mondayOf(day), dir * 7);

/** The Monday of the household's current week at `now`. */
export const currentWeek = (now: number, timeZone: string): DateKey =>
	mondayOf(dayIn(now, timeZone));

/** A valid `?week=` value: a real day (any day; the API snaps it to its Monday). */
export const isWeekParam = (v: unknown): v is DateKey => isCalendarDate(v);

export interface MealEntry {
	date: DateKey;
	meal: MealSlot;
	title: string;
}

/** Entries keyed `date|meal` for O(1) lookup in a grid. */
export const mealKey = (date: DateKey, meal: MealSlot) => `${date}|${meal}`;

export function mealMap(entries: readonly MealEntry[]): Map<string, string> {
	return new Map(entries.map((e) => [mealKey(e.date, e.meal), e.title]));
}

/** Compact one-line summary of a day for the calendar header: dinner if planned, else the first slot. */
export function daySummary(map: Map<string, string>, date: DateKey): string | null {
	for (const slot of ['dinner', 'lunch', 'breakfast', 'snack'] as const) {
		const t = map.get(mealKey(date, slot));
		if (t) return t;
	}
	return null;
}
