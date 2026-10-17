import { getDb } from '#lib/server/db/index.js';
import { completeChore } from '#lib/server/domain/ledger.js';
import { awardForCompletion } from '#lib/server/domain/streaks.js';
import { settleHabitStar } from '#lib/server/domain/habit-day.js';
import { notifyApprovalWaiting, notifyGoalsReached } from '#lib/server/notify.js';
import { dateStr, handle, localDate, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { memberId, date? }. Idempotent per chore/member/day. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	const now = Date.now();
	const memberId = str(body.memberId, 'memberId');
	const date = body.date === undefined ? localDate(now) : dateStr(body.date);
	return handle(() => {
		const db = getDb();
		const result = completeChore(db, { choreId: params.id, memberId, date, now });
		awardForCompletion(db, result.completion.id, { now });
		settleHabitStar(db, memberId, date, now);
		if (result.created && result.completion.status === 'pending') notifyApprovalWaiting(db);
		notifyGoalsReached(db);
		return result;
	});
};
