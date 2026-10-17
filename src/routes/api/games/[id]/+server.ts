import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteGame, updateGame } from '#lib/server/domain/games.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of { title, url, image } and/or { move: -1 | 1 } (one step up or down the list). */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => updateGame(getDb(), event.params.id, body));
};

/** Send a JSON content-type (body `{}`): SvelteKit's CSRF check refuses DELETEs without one. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteGame(getDb(), event.params.id));
};
