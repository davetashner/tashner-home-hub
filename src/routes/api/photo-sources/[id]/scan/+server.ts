import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { PhotoSourceError } from '#lib/server/photo-source/paths.js';
import { scanAndPrerender, viewSource } from '#lib/server/photo-source/service.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const db = getDb();
	if (!viewSource(db, event.params.id)) error(404, 'Photo source not found');
	try {
		const r = await scanAndPrerender(db, event.params.id);
		return json({
			added: r.added.length,
			changed: r.changed.length,
			removed: r.removed,
			source: viewSource(db, event.params.id)
		});
	} catch (e) {
		if (e instanceof PhotoSourceError) error(400, e.message);
		throw e;
	}
};
