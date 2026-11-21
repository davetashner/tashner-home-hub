import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { searchLights, udpExchange } from '#lib/server/lights.js';
import type { RequestHandler } from './$types';

/** Adult only. Looks for WiZ bulbs on the LAN and remembers new ones (a few seconds). */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	return json({ lights: await searchLights(getDb(), udpExchange()) });
};
