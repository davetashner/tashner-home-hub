import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { photoSources } from '#lib/server/db/schema.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { PhotoSourceError, validateRoot } from '#lib/server/photo-source/paths.js';
import { listSourceViews, scanAndPrerender, viewSource } from '#lib/server/photo-source/service.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(listSourceViews(getDb()));
};

/** Adds a folder source, scans it, and returns the discovered albums with counts. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	if (body.kind !== 'folder') error(400, 'Only kind "folder" is supported');
	const label = str(body.label, 'label');
	let root: string;
	try {
		root = await validateRoot(body.root);
	} catch (e) {
		if (e instanceof PhotoSourceError) error(400, e.message);
		throw e;
	}
	const db = getDb();
	const id = randomUUID();
	db.insert(photoSources)
		.values({
			id,
			kind: 'folder',
			label,
			config: JSON.stringify({ root, albums: [], recursive: true })
		})
		.run();
	await scanAndPrerender(db, id);
	return json(viewSource(db, id), { status: 201 });
};
