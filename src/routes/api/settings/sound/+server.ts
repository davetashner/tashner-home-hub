import { error, json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	DEFAULT_SOUND,
	parseSoundSettings,
	type SoundSettings
} from '#lib/domain/celebrate-logic.js';
import { parseSoundPatch } from '#lib/domain/sound-settings.js';
import { householdTimeZone } from '#lib/server/household.js';
import type { RequestHandler } from './$types';

const PREFIX = 'sound.';
const FIELDS = ['muted', 'quietStart', 'quietEnd', 'theme', 'volume'] as const;
const KEYS = FIELDS.map((f) => PREFIX + f);

function read(): SoundSettings {
	const rows = getDb()
		.select()
		.from(schema.settings)
		.where(inArray(schema.settings.key, KEYS))
		.all();
	const raw: Record<string, unknown> = { ...DEFAULT_SOUND };
	for (const row of rows) {
		try {
			raw[row.key.slice(PREFIX.length)] = JSON.parse(row.value);
		} catch {
			// keep the default for a corrupt value
		}
	}
	return parseSoundSettings({ ...raw, timeZone: householdTimeZone(getDb()) });
}

/** Kid-screen sound settings: unmuted, quiet 20:00 to 07:00 unless a grown-up changed them. */
export const GET: RequestHandler = () => json(read());

/** Adult only. Body: { muted?, quietStart?, quietEnd?, theme?, volume? } with times as 24-hour "HH:MM". */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const patch = parseSoundPatch(await readJson(event.request));
	if (typeof patch === 'string') error(400, patch);
	const db = getDb();
	for (const field of FIELDS) {
		if (patch[field] === undefined) continue;
		const value = JSON.stringify(patch[field]);
		db.insert(schema.settings)
			.values({ key: PREFIX + field, value })
			.onConflictDoUpdate({
				target: schema.settings.key,
				set: { value, updatedAt: Date.now() }
			})
			.run();
	}
	return json(read());
};
