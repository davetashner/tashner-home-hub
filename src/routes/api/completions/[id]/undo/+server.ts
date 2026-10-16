import { getDb } from '#lib/server/db/index.js';
import { isAdult } from '#lib/server/auth.js';
import { undoCompletion } from '#lib/server/domain/ledger.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Kids: within 10 s of the tap. Adults: any time. */
export const POST: RequestHandler = (event) =>
	handle(() =>
		undoCompletion(getDb(), event.params.id, { now: Date.now(), byAdult: isAdult(event) })
	);
