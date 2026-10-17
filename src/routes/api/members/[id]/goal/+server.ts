import { getDb } from '#lib/server/db/index.js';
import { currentAdult, requireAdult } from '#lib/server/auth.js';
import { getGoal, kidMayPickGoal, setGoal } from '#lib/server/domain/rewards.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** The member's current goal with progress, or null. Open: the kid screen reads it. */
export const GET: RequestHandler = ({ params }) => handle(() => getGoal(getDb(), params.id));

/**
 * Body: { rewardId }. Replaces any existing goal.
 * Adults may always. Without a PIN session the only allowed change is a child picking an existing,
 * active reward as their own goal.
 */
export const PUT: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const rewardId = str(body.rewardId, 'rewardId');
	// Deliberate auth relaxation, approved by the user (REW-5): a kid picks their own next goal
	// with no PIN, because it moves no stars. Anything else on this route stays adult-only.
	if (!currentAdult(event) && !kidMayPickGoal(getDb(), event.params.id, rewardId))
		requireAdult(event);
	return handle(() => setGoal(getDb(), event.params.id, rewardId));
};
