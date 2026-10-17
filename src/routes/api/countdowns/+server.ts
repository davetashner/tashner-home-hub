import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createCountdown, listCountdowns } from '#lib/server/domain/countdowns.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Every countdown, soonest first. The home screen filters out the expired ones. */
export const GET: RequestHandler = () => handle(() => listCountdowns(getDb()));

/** Body: { title, targetDate (YYYY-MM-DD), icon? }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() =>
		createCountdown(getDb(), {
			title: body.title as string,
			targetDate: body.targetDate as string,
			icon: body.icon as string | null | undefined
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
