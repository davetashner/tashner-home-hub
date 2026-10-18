import { getDb } from '#lib/server/db/index.js';
import { deleteSavedDrawing, getSavedDrawing } from '#lib/server/domain/saved-drawings.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** One drawing with its item data, to reopen it. */
export const GET: RequestHandler = (event) =>
	handle(() => getSavedDrawing(getDb(), event.params.id));

/** Anyone can delete a saved drawing. Send a JSON content-type (body `{}`): the CSRF check refuses bare DELETEs. */
export const DELETE: RequestHandler = (event) =>
	handle(() => deleteSavedDrawing(getDb(), event.params.id));
