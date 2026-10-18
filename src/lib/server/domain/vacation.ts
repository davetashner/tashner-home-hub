/** Household vacation setting (hub-k0w), stored as JSON in the settings table. */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { addDays } from '#lib/domain/streaks.js';
import { isVacationDay, parseVacation, type Vacation } from '#lib/domain/vacation.js';
import { localDateIn } from './chores.js';

export const VACATION_SETTING_KEY = 'streaks.vacation';

/** The stored vacation; missing or corrupt reads as none. */
export function readVacation(db: Db): Vacation | null {
	const row = db.select().from(settings).where(eq(settings.key, VACATION_SETTING_KEY)).get();
	if (!row) return null;
	try {
		return parseVacation(JSON.parse(row.value));
	} catch {
		return null;
	}
}

export function setVacation(db: Db, vacation: Vacation): Vacation {
	const value = JSON.stringify(vacation);
	db.insert(settings)
		.values({ key: VACATION_SETTING_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return vacation;
}

export function clearVacation(db: Db): void {
	db.delete(settings).where(eq(settings.key, VACATION_SETTING_KEY)).run();
}

/**
 * Ends the vacation today: the last vacation day is today and streaks resume tomorrow. A
 * vacation that has not started yet is removed. Returns what remains (null when removed).
 */
export function endVacationNow(
	db: Db,
	clock: { now?: number; timeZone?: string } = {}
): Vacation | null {
	const vacation = readVacation(db);
	if (!vacation) return null;
	const today = localDateIn(clock.now ?? Date.now(), clock.timeZone ?? householdTimeZone(db));
	if (vacation.start > today) {
		clearVacation(db);
		return null;
	}
	if (vacation.back !== null && vacation.back <= today) return vacation; // already over
	return setVacation(db, { start: vacation.start, back: addDays(today, 1) });
}

/** True when `date` is a vacation day for the whole household. */
export const onVacation = (db: Db, date: string): boolean => isVacationDay(readVacation(db), date);
