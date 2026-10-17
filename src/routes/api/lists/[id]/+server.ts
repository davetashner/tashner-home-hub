import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteList } from '#lib/server/domain/lists.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Removing a whole list is the one adult-only list action. Send a JSON content-type (body `{}`). */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteList(getDb(), event.params.id));
};
