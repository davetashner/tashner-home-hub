import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { pinLimiter } from '#lib/server/auth.js';
import {
	approveCompletion,
	pendingApprovals,
	rejectCompletion
} from '#lib/server/domain/ledger.js';
import { sitterApprover } from '#lib/server/domain/sitter.js';
import { awardForCompletion } from '#lib/server/domain/streaks.js';
import { notifyGoalsReached, notifyStreakMilestones } from '#lib/server/notify.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * The sitter approves Star Jobs with the sitter PIN, only when the parents allowed it for this
 * session. Body: { pin, action: 'list' } -> the waiting items; { pin, action: 'approve' | 'reject',
 * completionId }. Wrong PINs are rate limited per client together with /api/sitter/check.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	let address = 'unknown';
	try {
		address = event.getClientAddress();
	} catch {
		/* keep fallback */
	}
	const key = `${address}|sitter`;
	const now = Date.now();
	const waitMs = pinLimiter.remainingMs(key, now);
	if (waitMs > 0) {
		return json(
			{ message: 'Too many wrong attempts. Try again later.', retryAfterMs: waitMs },
			{ status: 429, headers: { 'retry-after': String(Math.ceil(waitMs / 1000)) } }
		);
	}
	const db = getDb();
	try {
		sitterApprover(db, body.pin, now);
	} catch (e) {
		const lockMs = pinLimiter.recordFailure(key, now);
		return json(
			{
				message: e instanceof Error ? e.message : 'Not allowed.',
				...(lockMs > 0 ? { retryAfterMs: lockMs } : {})
			},
			{ status: 403 }
		);
	}
	pinLimiter.recordSuccess(key);
	if (body.action === 'list') return handle(() => pendingApprovals(db));
	if (body.action !== 'approve' && body.action !== 'reject')
		return json({ message: 'Unknown action.' }, { status: 400 });
	const id = str(body.completionId, 'completionId');
	if (body.action === 'reject') return handle(() => rejectCompletion(db, id, {}));
	return handle(() => {
		const completion = approveCompletion(db, id);
		notifyStreakMilestones(db, completion.memberId, awardForCompletion(db, completion.id));
		notifyGoalsReached(db);
		return completion;
	});
};
