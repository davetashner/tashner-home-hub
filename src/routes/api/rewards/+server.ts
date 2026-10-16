import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createReward, listRewards } from '#lib/server/domain/rewards.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Query: includeArchived=1 also returns archived rewards. */
export const GET: RequestHandler = ({ url }) =>
	handle(() =>
		listRewards(getDb(), { includeArchived: url.searchParams.get('includeArchived') === '1' })
	);

/** Body: { title, cost, image? }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() =>
		createReward(getDb(), {
			title: body.title as string,
			cost: body.cost as number,
			image: body.image as string | null | undefined
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
