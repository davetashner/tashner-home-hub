import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { pendingApprovals } from '#lib/server/domain/ledger.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => pendingApprovals(getDb()));
};
