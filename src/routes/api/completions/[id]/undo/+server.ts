import { getDb } from '#lib/server/db/index.js';
import { isAdult } from '#lib/server/auth.js';
import { undoCompletion } from '#lib/server/domain/ledger.js';
import { settleHabitStar } from '#lib/server/domain/habit-day.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Kids: within 10 s of the tap. Adults: any time. */
export const POST: RequestHandler = (event) =>
	handle(() => {
		const db = getDb();
		const now = Date.now();
		const undone = undoCompletion(db, event.params.id, { now, byAdult: isAdult(event) });
		settleHabitStar(db, undone.memberId, undone.date, now);
		return undone;
	});
