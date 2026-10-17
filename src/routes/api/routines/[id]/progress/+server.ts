import { getDb } from '#lib/server/db/index.js';
import { completeRoutineStep } from '#lib/server/domain/routines.js';
import { dateStr, handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { date: YYYY-MM-DD, step: 0-based index just finished }. Kids call this, so no adult needed. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	const date = dateStr(body.date);
	return handle(() => completeRoutineStep(getDb(), params.id, date, body.step));
};
