import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { setRate } from '#lib/server/domain/allowance.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { stars, cents, symbol }. "10 stars = $1.00" is { stars: 10, cents: 100, symbol: "$" }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => setRate(getDb(), body));
};
