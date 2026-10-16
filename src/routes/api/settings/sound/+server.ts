import { json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { DEFAULT_SOUND, parseSoundSettings } from '#lib/domain/celebrate-logic.js';
import type { RequestHandler } from './$types';

const KEYS = ['sound.muted', 'sound.quietStart', 'sound.quietEnd'] as const;

/** Kid-screen sound settings: unmuted, quiet 20:00 to 07:00 unless a grown-up changed them. */
export const GET: RequestHandler = () => {
	const rows = getDb()
		.select()
		.from(schema.settings)
		.where(inArray(schema.settings.key, [...KEYS]))
		.all();
	const raw: Record<string, unknown> = { ...DEFAULT_SOUND };
	for (const row of rows) {
		try {
			raw[row.key.slice('sound.'.length)] = JSON.parse(row.value);
		} catch {
			// keep the default for a corrupt value
		}
	}
	return json(parseSoundSettings(raw));
};
