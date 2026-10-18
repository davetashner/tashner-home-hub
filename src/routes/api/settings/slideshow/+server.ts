import { error, json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	INTERVAL_STEPS,
	isIntervalSeconds,
	isTransition,
	parseSlideshowSettings,
	type SlideshowSettings
} from '#lib/domain/slideshow.js';
import { isOnThisDayMode } from '#lib/domain/on-this-day.js';
import type { RequestHandler } from './$types';

const PREFIX = 'slideshow.';
const KEYS = ['intervalSeconds', 'transition', 'onThisDay'].map((f) => PREFIX + f);

function read(): SlideshowSettings {
	const rows = getDb()
		.select()
		.from(schema.settings)
		.where(inArray(schema.settings.key, KEYS))
		.all();
	const raw: Record<string, unknown> = {};
	for (const row of rows) {
		try {
			raw[row.key.slice(PREFIX.length)] = JSON.parse(row.value);
		} catch {
			// keep the default for a corrupt value
		}
	}
	return parseSlideshowSettings(raw);
}

/** Open to the LAN like the slideshow itself (PHO-3): 30 s fades unless a grown-up changed them. */
export const GET: RequestHandler = () => json(read());

/** Adult only. Body: { intervalSeconds?, transition?, onThisDay? }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (body.intervalSeconds !== undefined && !isIntervalSeconds(body.intervalSeconds))
		error(400, `intervalSeconds must be one of ${INTERVAL_STEPS.join(', ')}`);
	if (body.transition !== undefined && !isTransition(body.transition))
		error(400, 'transition must be fade or kenburns');
	if (body.onThisDay !== undefined && !isOnThisDayMode(body.onThisDay))
		error(400, 'onThisDay must be off, favor or only');
	const db = getDb();
	for (const field of ['intervalSeconds', 'transition', 'onThisDay'] as const) {
		if (body[field] === undefined) continue;
		const value = JSON.stringify(body[field]);
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
