import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { createTimer, listTimers } from '#lib/server/domain/timers.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Every timer plus the server clock, so a screen with a skewed clock can still count down right. */
export const GET: RequestHandler = () =>
	json(
		{ now: Date.now(), timers: listTimers(getDb()) },
		{ headers: { 'cache-control': 'no-store' } }
	);

/** Body: { durationMs, label?, id? }. Open to every user: the kitchen is for everyone. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	const res = handle(() => createTimer(getDb(), body));
	return new Response(res.body, { status: 201, headers: res.headers });
};
