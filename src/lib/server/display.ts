import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { ROTATION_KEY, resolveRotation, type Rotation } from '#lib/domain/orientation.js';

/** The stored display rotation; landscape ("normal") until a grown-up changes it. */
export function readRotation(): Rotation {
	const row = getDb()
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, ROTATION_KEY))
		.get();
	if (!row) return resolveRotation(undefined);
	try {
		return resolveRotation(JSON.parse(row.value));
	} catch {
		return resolveRotation(undefined);
	}
}

export function writeRotation(rotation: Rotation): void {
	const value = JSON.stringify(rotation);
	getDb()
		.insert(schema.settings)
		.values({ key: ROTATION_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}
