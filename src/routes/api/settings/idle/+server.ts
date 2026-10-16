import { error, json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { isIdleMinutes, parseIdleSettings, type IdleSettings } from '#lib/domain/idle.js';
import type { RequestHandler } from './$types';

const FIELDS = ['homeMinutes', 'frameMinutes'] as const;
const KEYS = FIELDS.map((f) => `idle.${f}`);

function read(): IdleSettings {
	const rows = getDb()
		.select()
		.from(schema.settings)
		.where(inArray(schema.settings.key, KEYS))
		.all();
	const raw: Record<string, unknown> = {};
	for (const row of rows) {
		try {
			raw[row.key.slice('idle.'.length)] = JSON.parse(row.value);
		} catch {
			// keep the default for a corrupt value
		}
	}
	return parseIdleSettings(raw);
}

/** Idle timers (UI-6, PHO-4): home after 2 minutes, photo frame after 5, unless a grown-up changed them. */
export const GET: RequestHandler = () => json(read());

/** Adult only. Body: { homeMinutes?, frameMinutes? } in whole minutes, 0 turns a timer off. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	for (const field of FIELDS) {
		const v = body[field];
		if (v !== undefined && !isIdleMinutes(v))
			error(400, `${field} must be whole minutes from 0 to 1440`);
	}
	const db = getDb();
	for (const field of FIELDS) {
		if (body[field] === undefined) continue;
		const value = JSON.stringify(body[field]);
		db.insert(schema.settings)
			.values({ key: `idle.${field}`, value })
			.onConflictDoUpdate({
				target: schema.settings.key,
				set: { value, updatedAt: Date.now() }
			})
			.run();
	}
	return json(read());
};
