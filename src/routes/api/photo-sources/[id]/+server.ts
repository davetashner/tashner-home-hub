import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { photoSources } from '#lib/server/db/schema.js';
import { readJson, str } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { patchWindows } from '#lib/server/domain/album-window.js';
import { parseConfig } from '#lib/server/domain/photo-folder.js';
import { forgetSource } from '#lib/server/photo-source/folder.js';
import { viewSource } from '#lib/server/photo-source/service.js';
import type { RequestHandler } from './$types';

/**
 * Renames the source, sets the selected albums (empty list = all) and/or sets yearly album
 * windows (`windows: { [album]: { from: 'MM-DD', to: 'MM-DD' } | null }`, null clears one).
 */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const db = getDb();
	const source = db.select().from(photoSources).where(eq(photoSources.id, event.params.id)).get();
	if (!source) error(404, 'Photo source not found');
	const body = await readJson(event.request);
	const set: { label?: string; config?: string } = {};
	if (body.label !== undefined) set.label = str(body.label, 'label');
	const config = parseConfig(source.config);
	if (body.albums !== undefined) {
		if (!Array.isArray(body.albums) || !body.albums.every((a) => typeof a === 'string'))
			error(400, 'albums must be an array of album names');
		config.albums = body.albums;
		set.config = JSON.stringify(config);
	}
	if (body.windows !== undefined) {
		const windows = patchWindows(config.windows, body.windows);
		if (typeof windows === 'string') error(400, windows);
		config.windows = windows;
		set.config = JSON.stringify(config);
	}
	if (set.label !== undefined || set.config !== undefined)
		db.update(photoSources).set(set).where(eq(photoSources.id, source.id)).run();
	return json(viewSource(db, source.id));
};

/** Removes the source and its photo rows (cascade). Files on disk are never touched. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	const db = getDb();
	if (!db.select().from(photoSources).where(eq(photoSources.id, event.params.id)).get())
		error(404, 'Photo source not found');
	db.delete(photoSources).where(eq(photoSources.id, event.params.id)).run();
	forgetSource(db, event.params.id);
	return json({ deleted: true });
};
