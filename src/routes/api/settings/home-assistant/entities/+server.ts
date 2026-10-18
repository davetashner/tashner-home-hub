import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { listEntities } from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Adult only. Lights, switches and scenes Home Assistant offers. */
export const GET: RequestHandler = async (event) => {
	requireAdult(event);
	return json({ entities: await haRoute(() => listEntities()) });
};
