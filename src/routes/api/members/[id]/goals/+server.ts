import { getDb } from '#lib/server/db/index.js';
import { requireAdult, currentAdult } from '#lib/server/auth.js';
import { createOwnGoal, isKidSelfServe, listGoals } from '#lib/server/domain/rewards.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** All of the member's goals with progress, current first. Open: the kid screen reads it. */
export const GET: RequestHandler = ({ params }) => handle(() => listGoals(getDb(), params.id));

/**
 * Body: { title, cost, image? }. A kid names their own goal (it becomes current). No approval:
 * it moves no stars, and spending them still needs the adult PIN.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	if (!currentAdult(event) && !isKidSelfServe(getDb(), event.params.id)) requireAdult(event);
	const res = handle(() =>
		createOwnGoal(getDb(), event.params.id, {
			title: body.title as string,
			cost: body.cost as number,
			image: body.image as string | null | undefined
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
