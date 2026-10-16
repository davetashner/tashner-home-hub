import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { getGoal, setGoal } from '#lib/server/domain/rewards.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** The member's current goal with progress, or null. Open: the kid screen reads it. */
export const GET: RequestHandler = ({ params }) => handle(() => getGoal(getDb(), params.id));

/** Body: { rewardId }. Replaces any existing goal. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const rewardId = str(body.rewardId, 'rewardId');
	return handle(() => setGoal(getDb(), event.params.id, rewardId));
};
