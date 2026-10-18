import { json } from '@sveltejs/kit';
import { readJson } from '#lib/server/api.js';
import { activate } from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Any household screen (kids included). Body: { entityId }, which must be one of the picked tiles. */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	await haRoute(() => activate(body.entityId));
	return json({ ok: true });
};
