import { getDb } from '#lib/server/db/index.js';
import { logPractice, practiceSummary, undoPractice } from '#lib/server/domain/practice-logs.js';
import { isAdult } from '#lib/server/auth.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Today's reading and practice per activity: minutes, stars, minutes to the next star, whether the
 * daily cap is reached, and the newest log (for undo). Open: the kid screen reads it.
 */
export const GET: RequestHandler = ({ params }) =>
	handle(() => practiceSummary(getDb(), params.id, Date.now()));

/**
 * Body: { activityId, minutes }. A kid logs their own minutes with no sign-in and no approval:
 * the stars are approved at once (hub-kko.2). Returns { log, stars, summary }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await readJson(request);
	const res = handle(() =>
		logPractice(getDb(), {
			memberId: params.id,
			activityId: str(b.activityId, 'activityId'),
			minutes: b.minutes as number,
			now: Date.now()
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};

/** Body: { logId }. Takes a log back: a kid within the undo window, a signed-in grown-up any time. */
export const DELETE: RequestHandler = async (event) => {
	const b = await readJson(event.request);
	return handle(() =>
		undoPractice(getDb(), str(b.logId, 'logId'), {
			memberId: event.params.id,
			now: Date.now(),
			byAdult: isAdult(event)
		})
	);
};
