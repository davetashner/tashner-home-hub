import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { dismissNote, pinNote } from '#lib/server/domain/notes.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { pinned }. Pinning keeps a note on top and is adult-only. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => pinNote(getDb(), event.params.id, body.pinned));
};

/** Anyone can dismiss a note. Send a JSON content-type (body `{}`): the CSRF check refuses bare DELETEs. */
export const DELETE: RequestHandler = (event) =>
	handle(() => dismissNote(getDb(), event.params.id));
