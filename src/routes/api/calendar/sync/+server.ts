import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { runSync } from '#lib/server/calendar/sync.js';
import type { RequestHandler } from './$types';

/** On-demand sync (CAL-7). Joins a run already in progress. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	return json(await runSync(getDb()));
};
