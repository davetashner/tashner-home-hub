import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { archivedImage } from '#lib/server/domain/notes.js';
import type { RequestHandler } from './$types';

/** An archived drawing for the art book. Open to the LAN like the art book list. */
export const GET: RequestHandler = (event) => {
	const png = archivedImage(getDb(), event.params.id);
	if (!png) error(404, 'No such drawing');
	return new Response(new Uint8Array(png), {
		headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' }
	});
};
