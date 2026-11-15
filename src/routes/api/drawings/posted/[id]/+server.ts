import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteArchivedDrawing } from '#lib/server/domain/art-book.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Adult-only: take a drawing out of the art book. Send a JSON content-type (body `{}`) so the CSRF check passes. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteArchivedDrawing(getDb(), event.params.id));
};
