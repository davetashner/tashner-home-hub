import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { archiveReward } from '#lib/server/domain/rewards.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => archiveReward(getDb(), event.params.id));
};
