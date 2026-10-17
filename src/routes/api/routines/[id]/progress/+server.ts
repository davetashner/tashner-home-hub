import { getDb } from '#lib/server/db/index.js';
import { completeRoutineStep, routineMember } from '#lib/server/domain/routines.js';
import { settleHabitStar } from '#lib/server/domain/habit-day.js';
import { dateStr, handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { date: YYYY-MM-DD, step: 0-based index just finished }. Kids call this, so no adult needed. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	const date = dateStr(body.date);
	return handle(() => {
		const db = getDb();
		const progress = completeRoutineStep(db, params.id, date, body.step);
		// A finished routine counts as one habit toward the day's star.
		settleHabitStar(db, routineMember(db, params.id), date, Date.now());
		return progress;
	});
};
