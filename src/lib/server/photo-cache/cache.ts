import { createHash } from 'node:crypto';
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	utimes,
	writeFile
} from 'node:fs/promises';
import { join } from 'node:path';
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
import { resolvePhotoPath } from '../photo-source/paths.js';
import { readSourceInfo, renderBackdrop, renderMain } from './render.js';

export interface PhotoCacheOptions {
	db: Db;
	dir: string;
	maxBytes: number;
	concurrency?: number;
	resolvePath?: (photo: typeof schema.photos.$inferSelect) => string;
}

export interface RenderedPhoto {
	hash: string;
	background: boolean;
}

const exists = (p: string) =>
	access(p).then(
		() => true,
		() => false
	);
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
		const known = this.hashes.get(memo);
		if (known) return known;
		const hash = createHash('sha256')
			.update(await readFile(path))
			.digest('hex')
			.slice(0, 24);
		this.hashes.set(memo, hash);
		return hash;
	}

	private file(hash: string, target: Size, part: PhotoPart, format: PhotoFormat) {
		return join(this.opts.dir, variantName(hash, target, part, format));
	}

	/** Renders missing variants, records size/EXIF date; null if unknown or hidden. */
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
			if (!(await exists(mainPath))) {
				await this.write(mainPath, (await renderMain(path, target, format)).data);
			}
			const bgPath = this.file(hash, target, 'bg', format);
			if (background && !(await exists(bgPath))) {
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

	/** Cached variant (touched for LRU) or null. */
	async cachedVariant(
		photoId: string,
		target: Size,
		format: PhotoFormat,
		part: PhotoPart = 'main'
	): Promise<{ path: string; size: number; hash: string } | null> {
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
		return { path, size: st.size, hash };
	}

	/** Deletes least-recently-used variants until under `maxBytes`; returns count removed. */
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
}

export function cacheMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
	const mb = Number(env.HUB_PHOTO_CACHE_MB);
	return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

let instance: PhotoCache | undefined;

/** App-wide cache at `${DATA_DIR}/photo-cache`. */
export function getPhotoCache(): PhotoCache {
	const db = getDb();
	instance ??= new PhotoCache({
		db,
		dir: join(process.env.DATA_DIR ?? './data', 'photo-cache'),
		maxBytes: cacheMaxBytes(),
		concurrency: 1,
		resolvePath: (p) => resolvePhotoPath(db, p)
	});
	return instance;
}
