import { getDb } from '#lib/server/db/index.js';
import { funLockStatus } from '#lib/server/domain/fun-lock.js';
import { judgeMissedPeriods } from '#lib/server/domain/missed.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Whether Games and Music wait for this child (and what is left to finish). Open to kids. */
export const GET: RequestHandler = ({ params }) =>
	handle(() => {
		judgeMissedPeriods(getDb());
		return funLockStatus(getDb(), params.id);
	});
