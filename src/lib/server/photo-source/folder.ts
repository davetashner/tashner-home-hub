import { and, eq, inArray, sql } from 'drizzle-orm';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { schema, type Db } from '../db/index.js';
import {
	albumOf,
	hasChanged,
	isMotionFile,
	isSupportedFile,
	pairMotion,
	parseConfig,
	type FileSig
} from '../domain/photo-folder.js';
import { PhotoSourceError, validateRoot } from './paths.js';

export interface ScanResult {
	total: number;
	added: string[];
	changed: string[];
	removed: number;
}

export interface ScanStatus {
	at: number;
	count: number;
}

const BATCH = 500;
const YIELD_EVERY = 200;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** Last-seen (size, mtime) per source and relative path; in memory, so a restart re-trusts existing rows. */
const signatures = new Map<string, Map<string, FileSig>>();
const running = new Map<string, Promise<ScanResult>>();

const statusKey = (sourceId: string) => `photo-scan:${sourceId}`;

export function lastScan(db: Db, sourceId: string): ScanStatus | null {
	const row = db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, statusKey(sourceId)))
		.get();
	return row ? (JSON.parse(row.value) as ScanStatus) : null;
}

/** Walks `root` iteratively (symlinks are never followed), yielding to the event loop regularly. */
async function walk(root: string): Promise<{ found: Map<string, FileSig>; clips: string[] }> {
	const found = new Map<string, FileSig>();
	const clips: string[] = [];
	const dirs = [root];
	let n = 0;
	for (let dir = dirs.pop(); dir !== undefined; dir = dirs.pop()) {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const e of entries) {
			if (e.name.startsWith('.')) continue;
			const full = join(dir, e.name);
			if (e.isDirectory()) dirs.push(full);
			else if (e.isFile() && isSupportedFile(e.name)) {
				const st = await lstat(full).catch(() => null);
				if (st?.isFile()) found.set(relative(root, full), { size: st.size, mtimeMs: st.mtimeMs });
			} else if (e.isFile() && isMotionFile(e.name)) clips.push(relative(root, full));
			if (++n % YIELD_EVERY === 0) await tick();
		}
	}
	return { found, clips };
}

function chunk<T>(items: T[], size = BATCH): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function scan(db: Db, sourceId: string): Promise<ScanResult> {
	const source = db
		.select()
		.from(schema.photoSources)
		.where(eq(schema.photoSources.id, sourceId))
		.get();
	if (!source || source.kind !== 'folder') throw new PhotoSourceError('Folder source not found');
	const config = parseConfig(source.config);
	// Re-validate on every scan so a swapped symlink or changed HUB_PHOTO_ROOTS cannot widen access.
	const root = await validateRoot(config.root);
	const { found, clips } = await walk(root);
	const motion = pairMotion(found.keys(), clips);
	const prev = signatures.get(sourceId) ?? new Map<string, FileSig>();
	const rows = db
		.select({
			id: schema.photos.id,
			filePath: schema.photos.filePath,
			motionPath: schema.photos.motionPath
		})
		.from(schema.photos)
		.where(eq(schema.photos.sourceId, sourceId))
		.all();
	const existing = new Map(rows.map((r) => [r.filePath, r.id]));

	const added: string[] = [];
	const changed: string[] = [];
	const toInsert: { id: string; path: string }[] = [];
	const repaired = rows.filter(
		(r) => found.has(r.filePath) && (motion.get(r.filePath) ?? null) !== r.motionPath
	);
	for (const [path, sig] of found) {
		const id = existing.get(path);
		if (id === undefined) toInsert.push({ id: crypto.randomUUID(), path });
		else if (hasChanged(prev.get(path), sig)) changed.push(id);
	}
	const gone = rows.filter((r) => !found.has(r.filePath)).map((r) => r.id);

	for (const batch of chunk(toInsert)) {
		db.transaction((tx) => {
			for (const { id, path } of batch)
				tx.insert(schema.photos)
					.values({
						id,
						sourceId,
						filePath: path,
						album: albumOf(path),
						motionPath: motion.get(path) ?? null
					})
					.onConflictDoNothing()
					.run();
		});
		added.push(...batch.map((b) => b.id));
		await tick();
	}
	for (const batch of chunk(gone)) {
		db.delete(schema.photos).where(inArray(schema.photos.id, batch)).run();
		await tick();
	}
	// Clips appear, go or are renamed independently of their stills.
	for (const batch of chunk(repaired)) {
		db.transaction((tx) => {
			for (const r of batch)
				tx.update(schema.photos)
					.set({ motionPath: motion.get(r.filePath) ?? null })
					.where(eq(schema.photos.id, r.id))
					.run();
		});
		await tick();
	}
	// Changed files: forget dimensions/date so the cache re-reads them (hidden is untouched).
	for (const batch of chunk(changed)) {
		db.update(schema.photos)
			.set({ width: null, height: null, takenAt: null })
			.where(and(eq(schema.photos.sourceId, sourceId), inArray(schema.photos.id, batch)))
			.run();
	}
	signatures.set(sourceId, found);

	const count = found.size;
	db.insert(schema.settings)
		.values({ key: statusKey(sourceId), value: JSON.stringify({ at: Date.now(), count }) })
		.onConflictDoUpdate({
			target: schema.settings.key,
			set: {
				value: JSON.stringify({ at: Date.now(), count }),
				updatedAt: sql`(unixepoch('subsec') * 1000)`
			}
		})
		.run();
	return { total: count, added, changed, removed: gone.length };
}

/** Scans one folder source; concurrent calls for the same source share a run. */
export function scanSource(db: Db, sourceId: string): Promise<ScanResult> {
	let job = running.get(sourceId);
	if (!job) {
		job = scan(db, sourceId).finally(() => running.delete(sourceId));
		running.set(sourceId, job);
	}
	return job;
}

export function forgetSource(db: Db, sourceId: string): void {
	signatures.delete(sourceId);
	db.delete(schema.settings)
		.where(eq(schema.settings.key, statusKey(sourceId)))
		.run();
}
