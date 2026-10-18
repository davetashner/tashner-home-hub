import { getDb } from '#lib/server/db/index.js';
import { setOwner } from '#lib/server/domain/lists.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Body: { ownerId }, an adult's member id or null for House. Open to every device like the rest of
 * the list: the owner only groups and filters. A POST so the offline write queue can replay it.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => setOwner(getDb(), event.params.id, body.ownerId));
};
