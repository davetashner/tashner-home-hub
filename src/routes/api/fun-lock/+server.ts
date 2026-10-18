import { getDb } from '#lib/server/db/index.js';
import { funLocks } from '#lib/server/domain/fun-lock.js';
import { judgeMissedPeriods } from '#lib/server/domain/missed.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Every child's Games and Music lock, for the fun tabs. Open to kids. */
export const GET: RequestHandler = () =>
	handle(() => {
		judgeMissedPeriods(getDb());
		return funLocks(getDb());
	});
