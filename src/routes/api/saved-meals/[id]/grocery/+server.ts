import { getDb } from '#lib/server/db/index.js';
import { addIngredientsToList } from '#lib/server/domain/saved-meals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { listId? }. Adds the ingredients to Grocery (or the first list). Anyone may add, like list items. */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => addIngredientsToList(getDb(), event.params.id, body.listId));
};
