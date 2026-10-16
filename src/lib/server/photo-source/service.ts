import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import { parseConfig, ROOT_ALBUM, isAlbumSelected, stableShuffle } from '../domain/photo-folder.js';
import { lastScan, scanSource, type ScanResult } from './folder.js';
import { enqueuePrerender } from './prerender.js';

export interface SourceView {
	id: string;
	kind: string;
	label: string;
	root: string;
	albums: { name: string; count: number; selected: boolean }[];
	photoCount: number;
	lastScan: { at: number; count: number } | null;
}

export async function scanAndPrerender(db: Db, sourceId: string): Promise<ScanResult> {
	const result = await scanSource(db, sourceId);
	enqueuePrerender(db, [...result.added, ...result.changed]);
	return result;
}

export function viewSource(db: Db, id: string): SourceView | undefined {
	const s = db.select().from(schema.photoSources).where(eq(schema.photoSources.id, id)).get();
	if (!s) return undefined;
	const config = parseConfig(s.config);
	const counts = db
		.select({ album: schema.photos.album, n: sql<number>`count(*)` })
		.from(schema.photos)
		.where(eq(schema.photos.sourceId, id))
		.groupBy(schema.photos.album)
		.all();
	const albums = counts
		.map((c) => ({ name: c.album ?? ROOT_ALBUM, count: c.n }))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((a) => ({ ...a, selected: isAlbumSelected(a.name, config.albums) }));
	return {
		id: s.id,
		kind: s.kind,
		label: s.label,
		root: config.root,
		albums,
		photoCount: albums.reduce((n, a) => n + a.count, 0),
		lastScan: lastScan(db, id)
	};
}

export function listSourceViews(db: Db): SourceView[] {
	return db
		.select({ id: schema.photoSources.id })
		.from(schema.photoSources)
		.where(eq(schema.photoSources.kind, 'folder'))
		.all()
		.map((r) => viewSource(db, r.id)!);
}

/** Visible photos in selected albums, in a stable shuffled order. */
export function slideshow(db: Db, limit: number, seed = '') {
	const configs = new Map(
		db
			.select()
			.from(schema.photoSources)
			.all()
			.map((s) => [s.id, parseConfig(s.config).albums])
	);
	const rows = db
		.select({
			id: schema.photos.id,
			w: schema.photos.width,
			h: schema.photos.height,
			takenAt: schema.photos.takenAt,
			album: schema.photos.album,
			sourceId: schema.photos.sourceId
		})
		.from(schema.photos)
		.where(eq(schema.photos.hidden, false))
		.all()
		.filter((p) => isAlbumSelected(p.album, configs.get(p.sourceId) ?? []));
	return stableShuffle(rows, seed)
		.slice(0, limit)
		.map((p) => ({ id: p.id, w: p.w, h: p.h, takenAt: p.takenAt, album: p.album }));
}
