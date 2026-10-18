import { getDb } from '#lib/server/db/index.js';
import { createNote, listNotes } from '#lib/server/domain/notes.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Live notes, pinned first then newest. Open to every device, like a note on the fridge. */
export const GET: RequestHandler = () => handle(() => listNotes(getDb()));

/**
 * Body: { authorId, body, color?, until? ('today' | 'tomorrow' | 'week'), image? (PNG data URL) }.
 * A 300 KB image is ~400 KB of JSON, inside adapter-node's default 512 KB BODY_SIZE_LIMIT (not overridden).
 * No PIN: kids post too.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() =>
		createNote(getDb(), {
			authorId: body.authorId,
			body: body.body,
			color: body.color,
			until: body.until,
			image: body.image
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
