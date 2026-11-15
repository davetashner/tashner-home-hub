import { eq } from 'drizzle-orm';
import { parseChallenges, type Challenge } from '../../domain/drawing-challenges.js';
import { schema, type Db } from '../db/index.js';

const KEY = 'drawing.challenges';

/** Pending grown-up challenges (hub-t27j.11), kept as JSON in the settings table. */
export function readChallenges(db: Db): Challenge[] {
	const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
	if (!row) return [];
	try {
		return parseChallenges(JSON.parse(row.value));
	} catch {
		return [];
	}
}

export function writeChallenges(db: Db, list: readonly Challenge[]): void {
	const value = JSON.stringify(list);
	db.insert(schema.settings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}
