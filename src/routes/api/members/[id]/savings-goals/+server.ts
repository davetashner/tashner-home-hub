import { getDb } from '#lib/server/db/index.js';
import { createSavingsGoal, listSavingsGoals } from '#lib/server/domain/savings-goals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * The member's money goals: { balanceCents, symbol, goals: [{ id, title, emoji, targetCents, savedCents,
 * reached, current, status, createdAt, boughtAt }] }. Open: the kid screen reads it.
 * Archived goals are hidden.
 */
export const GET: RequestHandler = ({ params }) =>
	handle(() => listSavingsGoals(getDb(), params.id));

/**
 * Body: { title, targetCents, emoji? }. Returns the new goal. Open to kids (no PIN): it moves no
 * money, so a kid sets up their own goal. The first goal becomes current.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() => createSavingsGoal(getDb(), event.params.id, body));
	return new Response(res.body, { status: 201, headers: res.headers });
};
