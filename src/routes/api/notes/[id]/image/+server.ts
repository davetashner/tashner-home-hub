import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { noteFrame, noteImage } from '#lib/server/domain/notes.js';
import type { RequestHandler } from './$types';

/** The drawing on a note. Open to every device, like the note itself. */
export const GET: RequestHandler = (event) => {
	const f = Number(event.url.searchParams.get('f') ?? 0);
	const png = f > 0 ? noteFrame(getDb(), event.params.id, f) : noteImage(getDb(), event.params.id);
	if (!png) error(404, 'No drawing on this note');
	return new Response(new Uint8Array(png), {
		headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }
	});
};
