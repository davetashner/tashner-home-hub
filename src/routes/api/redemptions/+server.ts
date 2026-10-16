import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { redeemReward, redemptionLog } from '#lib/server/domain/redemptions.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** The redemption log, newest first. Query: memberId?, limit? (1-200). Adults only. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const memberId = event.url.searchParams.get('memberId') ?? undefined;
	const limit = Number(event.url.searchParams.get('limit') ?? 50) || 50;
	return handle(() => redemptionLog(getDb(), { memberId, limit }));
};

/** Body: { memberId, rewardId }. Spends the child's stars; the signed-in adult approves it. */
export const POST: RequestHandler = async (event) => {
	const adult = requireAdult(event);
	const body = await readJson(event.request);
	const memberId = str(body.memberId, 'memberId');
	const rewardId = str(body.rewardId, 'rewardId');
	const res = handle(() => redeemReward(getDb(), { memberId, rewardId, approvedBy: adult.id }));
	return new Response(res.body, { status: 201, headers: res.headers });
};
