import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { sessionLog } from '#lib/server/domain/sitter.js';
import type { RequestHandler } from './$types';

/** Adult only: the last 10 finished sessions with their check-ins, newest first. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(sessionLog(getDb(), Date.now()));
};
