import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import {
	albumShows,
	anyWindowOpen,
	isWindowOpen,
	type AlbumRules,
	type AlbumWindow,
	type MonthDay
} from '../domain/album-window.js';
import { localDateIn } from '../domain/chores.js';
import { parseConfig, ROOT_ALBUM, isAlbumSelected, stableShuffle } from '../domain/photo-folder.js';
import { householdTimeZone } from '../household.js';
import { lastScan, scanSource, type ScanResult } from './folder.js';
import { enqueuePrerender } from './prerender.js';

export interface SourceView {
	id: string;
	kind: string;
	label: string;
	root: string;
	albums: {
		name: string;
		count: number;
		selected: boolean;
		/** Shows only between these days each year; `open` = inside the window today. */
		window: (AlbumWindow & { open: boolean }) | null;
	}[];
	photoCount: number;
	lastScan: { at: number; count: number } | null;
}

export async function scanAndPrerender(db: Db, sourceId: string): Promise<ScanResult> {
	const result = await scanSource(db, sourceId);
	enqueuePrerender(db, [...result.added, ...result.changed]);
	return result;
}

/** Today's `MM-DD` in the household time zone. */
export function todayMonthDay(db: Db, now = Date.now()): MonthDay {
	return localDateIn(now, householdTimeZone(db)).slice(5);
}

export function viewSource(db: Db, id: string, today = todayMonthDay(db)): SourceView | undefined {
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
		.map((a) => {
			const w = config.windows[a.name];
			return {
				...a,
				selected: isAlbumSelected(a.name, config.albums),
				window: w ? { ...w, open: isWindowOpen(w, today) } : null
			};
		});
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

/**
 * Visible photos in selected albums, in a stable shuffled order. While an album's yearly window
 * is open, only windowed albums show.
 */
export function slideshow(db: Db, limit: number, seed = '', today = todayMonthDay(db)) {
	const rules = new Map<string, AlbumRules>(
		db
			.select()
			.from(schema.photoSources)
			.all()
			.map((s) => {
				const c = parseConfig(s.config);
				return [
					s.id,
					{ selected: (album) => isAlbumSelected(album, c.albums), windows: c.windows }
				];
			})
	);
	const takeover = anyWindowOpen([...rules.values()], today);
	const unknownSource: AlbumRules = { selected: () => true, windows: {} };
	const rows = db
		.select({
			id: schema.photos.id,
			w: schema.photos.width,
			h: schema.photos.height,
			takenAt: schema.photos.takenAt,
			motion: schema.photos.motionPath,
			album: schema.photos.album,
			sourceId: schema.photos.sourceId
		})
		.from(schema.photos)
		.where(eq(schema.photos.hidden, false))
		.all()
		.filter((p) =>
			albumShows(p.album ?? ROOT_ALBUM, rules.get(p.sourceId) ?? unknownSource, today, takeover)
		);
	return stableShuffle(rows, seed)
		.slice(0, limit)
		.map((p) => ({
			id: p.id,
			w: p.w,
			h: p.h,
			takenAt: p.takenAt,
			album: p.album,
			motion: p.motion !== null
		}));
}
