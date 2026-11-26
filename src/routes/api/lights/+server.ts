import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { lightStates, udpExchange } from '#lib/server/lights.js';
import type { RequestHandler } from './$types';

/** Adult only. The remembered WiZ bulbs with their live state. */
export const GET: RequestHandler = async (event) => {
	requireAdult(event);
	return json({ lights: await lightStates(getDb(), udpExchange()) });
};
