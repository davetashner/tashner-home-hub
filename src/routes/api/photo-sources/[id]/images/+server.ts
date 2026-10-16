import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { photos } from '#lib/server/db/schema.js';
import { requireAdult } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

/** Adult-only listing including hidden photos, for the management grid. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const q = event.url.searchParams;
	const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 48));
	const offset = Math.max(0, Number(q.get('offset')) || 0);
	const rows = getDb()
		.select({ id: photos.id, album: photos.album, hidden: photos.hidden })
		.from(photos)
		.where(eq(photos.sourceId, event.params.id))
		.orderBy(asc(photos.filePath))
		.limit(limit)
		.offset(offset)
		.all();
	return json(rows);
};
