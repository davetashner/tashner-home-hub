import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { markSavingsGoalBought } from '#lib/server/domain/savings-goals.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Adult only. Pays out the goal's price from the allowance ledger and marks it bought.
 * Returns { goal, balanceCents }; 409 when the balance does not cover the price.
 */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => markSavingsGoalBought(getDb(), event.params.id, event.params.goalId));
};
