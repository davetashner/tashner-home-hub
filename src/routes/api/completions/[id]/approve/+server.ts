import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { approveCompletion } from '#lib/server/domain/ledger.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => approveCompletion(getDb(), event.params.id));
};
