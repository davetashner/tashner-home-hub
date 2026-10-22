import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { BIRTHDAYS_SETTING_KEY, resolveBirthdays, type Birthday } from '#lib/domain/birthdays.js';

/** The household's birthday dates (settings table, JSON). Empty when unset or unreadable. */
export function readBirthdays(): Birthday[] {
	const row = getDb()
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, BIRTHDAYS_SETTING_KEY))
		.get();
	try {
		return resolveBirthdays(row ? JSON.parse(row.value) : undefined);
	} catch {
		return [];
	}
}

export function writeBirthdays(list: Birthday[]): void {
	const value = JSON.stringify(list);
	getDb()
		.insert(schema.settings)
		.values({ key: BIRTHDAYS_SETTING_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}
