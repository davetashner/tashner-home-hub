import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteRoutine } from '#lib/server/domain/routines.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Send a JSON content-type with the DELETE: SvelteKit's CSRF check rejects bodyless writes. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteRoutine(getDb(), event.params.id));
};
