import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { approveCompletion } from '#lib/server/domain/ledger.js';
import { awardForCompletion } from '#lib/server/domain/streaks.js';
import { notifyGoalsReached, notifyStreakMilestones } from '#lib/server/notify.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => {
		const db = getDb();
		const completion = approveCompletion(db, event.params.id);
		notifyStreakMilestones(db, completion.memberId, awardForCompletion(db, completion.id));
		notifyGoalsReached(db);
		return completion;
	});
};
