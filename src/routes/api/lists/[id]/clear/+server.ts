import { getDb } from '#lib/server/db/index.js';
import { clearChecked } from '#lib/server/domain/lists.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Removes every checked item from the list. Body: {}. */
export const POST: RequestHandler = async (event) => {
	await readJson(event.request);
	return handle(() => clearChecked(getDb(), event.params.id));
};
