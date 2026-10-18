import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createSavedMeal, listSavedMeals } from '#lib/server/domain/saved-meals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Anyone may read. */
export const GET: RequestHandler = () => handle(() => listSavedMeals(getDb()));

/** Body: { name, emoji?, ingredients? } (ingredients: string[]). Adults only. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() => createSavedMeal(getDb(), body));
	return new Response(res.body, { status: 201, headers: res.headers });
};
