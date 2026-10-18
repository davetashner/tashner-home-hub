import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { unlockFun } from '#lib/server/domain/fun-lock.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Adult only. Lets the child into Games and Music for the rest of today; logs who and when. */
export const POST: RequestHandler = (event) => {
	const adult = requireAdult(event);
	return handle(() => unlockFun(getDb(), { memberId: event.params.id, by: adult }));
};
