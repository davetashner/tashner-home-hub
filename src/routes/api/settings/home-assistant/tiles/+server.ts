import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { saveTiles } from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Adult only. Body: { tiles: [{ entityId, name }] } in wall order. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return json({ tiles: await haRoute(() => saveTiles(body.tiles)) });
};
