import { getDb } from '#lib/server/db/index.js';
import { requireAdult, currentAdult } from '#lib/server/auth.js';
import { isKidSelfServe, removeGoal } from '#lib/server/domain/rewards.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Drops a goal from the member's list (a kid-named one is archived). Kids may drop their own. */
export const DELETE: RequestHandler = (event) => {
	if (!currentAdult(event) && !isKidSelfServe(getDb(), event.params.id)) requireAdult(event);
	return handle(() => {
		removeGoal(getDb(), event.params.id, event.params.rewardId);
		return { ok: true };
	});
};
