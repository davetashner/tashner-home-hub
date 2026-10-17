import { getDb } from '#lib/server/db/index.js';
import { deleteItem, setDone } from '#lib/server/domain/lists.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { done }. A POST (not PATCH) so the offline write queue can replay it; it sets, never toggles. */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => setDone(getDb(), event.params.id, body.done));
};

/** Send a JSON content-type (body `{}`): SvelteKit's CSRF check refuses DELETEs without one. */
export const DELETE: RequestHandler = (event) => handle(() => deleteItem(getDb(), event.params.id));
