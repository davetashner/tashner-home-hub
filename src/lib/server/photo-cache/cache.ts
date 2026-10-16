import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	utimes,
	writeFile
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '../db/index.js';
import {
	DEFAULT_TARGET,
	planRender,
	selectEvictions,
	variantName,
	type PhotoFormat,
	type PhotoPart,
	type Size
} from '../domain/photo-fit.js';
import { readSourceInfo, renderBackdrop, renderMain } from './render.js';

export interface PhotoCacheOptions {
	db: Db;
	/** Directory holding rendered variants (created on demand). */
	dir: string;
	maxBytes: number;
	/** Parallel renders; 1-2 keeps the server responsive. */
	concurrency?: number;
	/** Maps a photos row to a readable absolute path. */
	resolvePath?: (photo: typeof schema.photos.$inferSelect) => string;
}

export interface RenderedPhoto {
	hash: string;
	background: boolean;
}

const defaultResolve = (photo: { filePath: string }) => photo.filePath;

class Queue {
	private active = 0;
	private waiting: (() => void)[] = [];
	constructor(private readonly limit: number) {}
	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
		this.active++;
		try {
			return await fn();
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}

export class PhotoCache {
	private readonly queue: Queue;
	private readonly inflight = new Map<string, Promise<RenderedPhoto | null>>();
	/** path+mtime+size -> content hash, so repeat requests do not re-read the file. */
	private readonly hashes = new Map<string, string>();

	constructor(private readonly opts: PhotoCacheOptions) {
		this.queue = new Queue(Math.min(2, Math.max(1, opts.concurrency ?? 1)));
	}

	private photo(photoId: string) {
		const row = this.opts.db
			.select()
			.from(schema.photos)
			.where(eq(schema.photos.id, photoId))
			.get();
		return row && !row.hidden ? row : undefined;
	}

	private async contentHash(path: string): Promise<string> {
		const st = await stat(path);
		const memo = `${path}:${st.mtimeMs}:${st.size}`;
		let hash = this.hashes.get(memo);
		if (!hash) {
			hash = createHash('sha256')
				.update(await readFile(path))
				.digest('hex')
				.slice(0, 24);
			this.hashes.set(memo, hash);
			if (this.hashes.size > 10_000) this.hashes.clear();
		}
		return hash;
	}

	private file(hash: string, target: Size, part: PhotoPart, format: PhotoFormat) {
		return join(this.opts.dir, variantName(hash, target, part, format));
	}

	private async exists(path: string): Promise<boolean> {
		return stat(path).then(
			() => true,
			() => false
		);
	}

	/**
	 * Renders (if missing) the requested formats for a photo and records its dimensions and
	 * EXIF date. Returns null for unknown or hidden photos. Concurrent calls share one render.
	 */
	ensureRendered(
		photoId: string,
		target: Size = DEFAULT_TARGET,
		formats: PhotoFormat[] = ['avif', 'webp']
	): Promise<RenderedPhoto | null> {
		const key = `${photoId}:${target.width}x${target.height}:${formats.join(',')}`;
		let job = this.inflight.get(key);
		if (!job) {
			job = this.queue
				.run(() => this.render(photoId, target, formats))
				.finally(() => this.inflight.delete(key));
			this.inflight.set(key, job);
		}
		return job;
	}

	private async render(
		photoId: string,
		target: Size,
		formats: PhotoFormat[]
	): Promise<RenderedPhoto | null> {
		const photo = this.photo(photoId);
		if (!photo) return null;
		const path = (this.opts.resolvePath ?? defaultResolve)(photo);
		const hash = await this.contentHash(path);

		const info = await readSourceInfo(path);
		if (photo.width !== info.width || photo.height !== info.height || photo.takenAt === null) {
			this.opts.db
				.update(schema.photos)
				.set({
					width: info.width,
					height: info.height,
					takenAt: photo.takenAt ?? info.takenAt ?? null
				})
				.where(eq(schema.photos.id, photoId))
				.run();
		}

		await mkdir(this.opts.dir, { recursive: true });
		const { background } = planRender(info, undefined, target);
		for (const format of formats) {
			const mainPath = this.file(hash, target, 'main', format);
			if (!(await this.exists(mainPath))) {
				await this.write(mainPath, (await renderMain(path, target, format)).data);
			}
			const bgPath = this.file(hash, target, 'bg', format);
			if (background && !(await this.exists(bgPath))) {
				await this.write(bgPath, await renderBackdrop(path, target, format));
			}
		}
		await this.evict();
		return { hash, background };
	}

	private async write(path: string, data: Buffer) {
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, data);
		await rename(tmp, path);
	}

	/** Path of an already-rendered variant (marks it recently used), or null if not cached. */
	async cachedVariant(
		photoId: string,
		target: Size,
		format: PhotoFormat,
		part: PhotoPart = 'main'
	): Promise<{ path: string; size: number; hash: string; mtimeMs: number } | null> {
		const photo = this.photo(photoId);
		if (!photo) return null;
		let hash: string;
		try {
			hash = await this.contentHash((this.opts.resolvePath ?? defaultResolve)(photo));
		} catch {
			return null;
		}
		const path = this.file(hash, target, part, format);
		const st = await stat(path).catch(() => null);
		if (!st) return null;
		const now = new Date();
		await utimes(path, now, now).catch(() => undefined); // LRU touch
		return { path, size: st.size, hash, mtimeMs: now.getTime() };
	}

	/** Deletes least-recently-used variants until the cache fits `maxBytes`. Returns files removed. */
	async evict(): Promise<number> {
		const names = await readdir(this.opts.dir).catch(() => [] as string[]);
		const entries = [];
		for (const name of names) {
			if (name.endsWith('.tmp')) continue;
			const st = await stat(join(this.opts.dir, name)).catch(() => null);
			if (st?.isFile()) entries.push({ key: name, size: st.size, usedAt: st.mtimeMs });
		}
		const doomed = selectEvictions(entries, this.opts.maxBytes);
		for (const name of doomed) await unlink(join(this.opts.dir, name)).catch(() => undefined);
		return doomed.length;
	}

	stream(path: string) {
		return createReadStream(path);
	}
}

export function cacheMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
	const mb = Number(env.HUB_PHOTO_CACHE_MB);
	return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

let instance: PhotoCache | undefined;

/** App-wide cache at `${DATA_DIR}/photo-cache`. */
export function getPhotoCache(): PhotoCache {
	instance ??= new PhotoCache({
		db: getDb(),
		dir: join(process.env.DATA_DIR ?? './data', 'photo-cache'),
		maxBytes: cacheMaxBytes(),
		concurrency: 1,
		resolvePath: (p) => (isAbsolute(p.filePath) ? p.filePath : join(process.cwd(), p.filePath))
	});
	return instance;
}
