/** Meal plan storage (requirements MEAL-1). Slot and week rules live in `#lib/domain/meals.js`. */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { addDays } from '#lib/domain/calendar-view/zone.js';
import {
	cleanMealText,
	isMealSlot,
	isWeekParam,
	mondayOf,
	type MealEntry
} from '#lib/domain/meals.js';
import { isCalendarDate } from '#lib/domain/countdowns.js';
import type { Db } from '../db/index.js';
import { mealPlanEntries } from '../db/schema.js';
import { LedgerError } from './ledger.js';

const invalid = (msg: string) => new LedgerError('invalid', msg);

function slotAndDate(date: unknown, meal: unknown) {
	if (!isCalendarDate(date)) throw invalid('date must be a real day, YYYY-MM-DD');
	if (!isMealSlot(meal)) throw invalid('meal must be breakfast, lunch, dinner or snack');
	return { date, meal };
}

/** Entries for the Monday-to-Sunday week holding `day`. */
export function listWeek(db: Db, day: unknown): MealEntry[] {
	if (!isWeekParam(day)) throw invalid('week must be a real day, YYYY-MM-DD');
	const monday = mondayOf(day);
	return listRange(db, monday, addDays(monday, 6));
}

/** Entries between two days, inclusive. */
export function listRange(db: Db, from: string, to: string): MealEntry[] {
	if (!isCalendarDate(from) || !isCalendarDate(to)) throw invalid('from and to must be real days');
	return db
		.select({
			date: mealPlanEntries.date,
			meal: mealPlanEntries.meal,
			title: mealPlanEntries.title
		})
		.from(mealPlanEntries)
		.where(and(gte(mealPlanEntries.date, from), lte(mealPlanEntries.date, to)))
		.orderBy(asc(mealPlanEntries.date))
		.all() as MealEntry[];
}

/** Sets the text for a day and slot, replacing what was there. */
export function setMeal(db: Db, input: Record<string, unknown>): MealEntry {
	const { date, meal } = slotAndDate(input.date, input.meal);
	const title = cleanMealText(input.title);
	if (title === null) throw invalid('title must be 1-100 characters');
	return db.transaction((tx) => {
		const where = and(eq(mealPlanEntries.date, date), eq(mealPlanEntries.meal, meal));
		const existing = tx.select().from(mealPlanEntries).where(where).get();
		if (existing) tx.update(mealPlanEntries).set({ title }).where(where).run();
		else tx.insert(mealPlanEntries).values({ id: randomUUID(), date, meal, title }).run();
		return { date, meal, title };
	});
}

/** Clears a slot. Idempotent: clearing an empty slot succeeds, so a replayed offline DELETE is harmless. */
export function deleteMeal(db: Db, input: Record<string, unknown>): { date: string; meal: string } {
	const { date, meal } = slotAndDate(input.date, input.meal);
	db.delete(mealPlanEntries)
		.where(and(eq(mealPlanEntries.date, date), eq(mealPlanEntries.meal, meal)))
		.run();
	return { date, meal };
}
