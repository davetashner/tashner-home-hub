import { getDb } from '#lib/server/db/index.js';
import { setCurrentSavingsGoal } from '#lib/server/domain/savings-goals.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Makes this the member's current goal. Open to kids (no PIN): it moves no money. */
export const PUT: RequestHandler = ({ params }) =>
	handle(() => setCurrentSavingsGoal(getDb(), params.id, params.goalId));
