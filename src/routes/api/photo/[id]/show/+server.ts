import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { photos } from '#lib/server/db/schema.js';
import { requireAdult } from '#lib/server/auth.js';
import { publish } from '#lib/server/domain/events.js';
import type { RequestHandler } from './$types';

/**
 * "Show now" (hub-5yt.2): wall displays open the photo frame on this photo. They are told over the
 * `frame` event topic; a touch closes the frame as usual. A hidden photo is never pushed.
 */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	const id = event.params.id;
	const row = getDb().select({ hidden: photos.hidden }).from(photos).where(eq(photos.id, id)).get();
	if (!row) error(404, 'Photo not found');
	if (row.hidden) error(409, 'That photo is hidden from the photo frame');
	publish('frame', { photo: id });
	return json({ id });
};
