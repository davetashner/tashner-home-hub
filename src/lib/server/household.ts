import { eq } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';
import {
	HOUSEHOLD_TZ_KEY,
	canonicalZone,
	defaultTimeZone,
	resolveTimeZone
} from '#lib/domain/time-zone.js';

/** The household's IANA zone: the saved setting, else `TZ`, else the server's own zone. */
export function householdTimeZone(db: Db): string {
	const row = db.select().from(settings).where(eq(settings.key, HOUSEHOLD_TZ_KEY)).get();
	let stored: unknown = null;
	try {
		stored = row ? JSON.parse(row.value) : null;
	} catch {
		// a corrupt value falls back to the default
	}
	return resolveTimeZone(stored, defaultTimeZone(process.env.TZ));
}

/** Saves a zone (canonical spelling) and returns it, or null when it is not an IANA zone. */
export function setHouseholdTimeZone(db: Db, value: unknown): string | null {
	const zone = canonicalZone(value);
	if (!zone) return null;
	const json = JSON.stringify(zone);
	db.insert(settings)
		.values({ key: HOUSEHOLD_TZ_KEY, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: Date.now() } })
		.run();
	return zone;
}
