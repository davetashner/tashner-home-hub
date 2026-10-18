import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { GoogleError } from '#lib/server/calendar/google.js';
import { startImport } from '#lib/server/photo-source/google-import.js';
import type { RequestHandler } from './$types';

/** Creates a picker session for a folder source and starts waiting for the pick, then importing. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const sourceId = str(body.sourceId, 'sourceId');
	try {
		return json(await startImport(getDb(), { sourceId, album: body.album }), { status: 201 });
	} catch (e) {
		if (e instanceof GoogleError) error(e.needsReauth ? 401 : 400, e.message);
		throw e;
	}
};
