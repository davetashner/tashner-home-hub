import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createSession, listSessions } from '#lib/server/domain/sitter.js';
import { sweepSitterNotices } from '#lib/server/notify.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Adult only: recent sessions, newest first. Never includes PIN hashes. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(listSessions(getDb(), Date.now()));
};

/**
 * Adult only. Body: { endAt (ms), startAt? (ms, default now), sitterName?, pin? (4 digits),
 * approveJobs? (default false), funAllowed? (default true) }.
 */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() => createSession(getDb(), body, Date.now()));
	sweepSitterNotices(getDb());
	return new Response(res.body, { status: 201, headers: res.headers });
};
