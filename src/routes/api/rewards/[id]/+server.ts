import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { updateReward } from '#lib/server/domain/rewards.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of { title, cost, image }. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() =>
		updateReward(getDb(), event.params.id, {
			title: body.title as string | undefined,
			cost: body.cost as number | undefined,
			image: body.image as string | null | undefined
		})
	);
};
