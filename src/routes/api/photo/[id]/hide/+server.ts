import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { photos } from '#lib/server/db/schema.js';
import { requireAdult } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

/** Body `{hidden?: boolean}` (default true). The flag survives rescans. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body: unknown = await event.request.json().catch(() => ({}));
	const hidden = !(
		body &&
		typeof body === 'object' &&
		(body as { hidden?: unknown }).hidden === false
	);
	const res = getDb().update(photos).set({ hidden }).where(eq(photos.id, event.params.id)).run();
	if (res.changes === 0) error(404, 'Photo not found');
	return json({ id: event.params.id, hidden });
};
