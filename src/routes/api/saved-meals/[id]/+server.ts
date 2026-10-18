import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteSavedMeal, updateSavedMeal } from '#lib/server/domain/saved-meals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of { name, emoji, ingredients }. Adults only. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => updateSavedMeal(getDb(), event.params.id, body));
};

/** Adults only. Send a JSON content-type: SvelteKit's CSRF check refuses DELETEs without one. */
export const DELETE: RequestHandler = async (event) => {
	requireAdult(event);
	await readJson(event.request);
	return handle(() => deleteSavedMeal(getDb(), event.params.id));
};
