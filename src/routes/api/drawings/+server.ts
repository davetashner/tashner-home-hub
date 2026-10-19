import { getDb } from '#lib/server/db/index.js';
import { listSavedDrawings, saveDrawing } from '#lib/server/domain/saved-drawings.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Saved drawings with thumbnails, newest first. Open to every device, like the notes board. */
export const GET: RequestHandler = () => handle(() => listSavedDrawings(getDb()));

/**
 * Body: { memberId, data (drawing JSON), thumb (small PNG data URL), id? (overwrite that drawing) }.
 * data is at most 400 KB and the thumb 300 KB: under adapter-node's 512 KB body limit together
 * because the sheet sends a thumbnail of a few KB. No PIN: kids save too.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() =>
		saveDrawing(getDb(), {
			memberId: body.memberId,
			data: body.data,
			thumb: body.thumb,
			id: body.id
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
