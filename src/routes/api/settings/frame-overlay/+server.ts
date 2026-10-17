import { error, json } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	OVERLAY_FIELDS,
	parseOverlaySettings,
	type OverlaySettings
} from '#lib/domain/frame-overlay.js';
import type { RequestHandler } from './$types';

const PREFIX = 'frame-overlay.';
const KEYS = OVERLAY_FIELDS.map((f) => PREFIX + f);

function read(): OverlaySettings {
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
	return parseOverlaySettings(raw);
}

/** Open to the LAN like the frame itself (PHO-7): everything is on unless a grown-up turned it off. */
export const GET: RequestHandler = () => json(read());

/** Adult only. Body: { clock?, date?, weather?, nextEvent? }, each a boolean. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	for (const field of OVERLAY_FIELDS)
		if (body[field] !== undefined && typeof body[field] !== 'boolean')
			error(400, `${field} must be true or false`);
	const db = getDb();
	for (const field of OVERLAY_FIELDS) {
		if (body[field] === undefined) continue;
		const value = JSON.stringify(body[field]);
		db.insert(schema.settings)
			.values({ key: PREFIX + field, value })
			.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
			.run();
	}
	return json(read());
};
