import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { photoSources, photos } from '../db/schema.js';
import { PhotoCache } from './cache.js';
import { syntheticJpeg } from './fixtures.js';
import { renderBackdrop, renderMain } from './render.js';

const LAND = { width: 640, height: 360 };
let root: string;
let db: Db;
let cache: PhotoCache;

function addPhoto(id: string, buf: Buffer, hidden = false) {
	const filePath = join(root, `${id}.jpg`);
	writeFileSync(filePath, buf);
	db.insert(photos).values({ id, sourceId: 's', filePath, hidden }).run();
	return filePath;
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'hub-photo-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
	db = openDb(':memory:');
	db.insert(photoSources).values({ id: 's', kind: 'folder', label: 'test' }).run();
	cache = new PhotoCache({ db, dir: join(root, `cache-${Math.random()}`), maxBytes: 1e9 });
});

describe('render', () => {
	it('fits a portrait photo, adds a full-size blurred backdrop, strips EXIF', async () => {
		const path = addPhoto('p', await syntheticJpeg(300, 400, { takenAt: '2020:01:02 03:04:05' }));
		const main = await renderMain(path, LAND, 'avif');
		const meta = await sharp(main.data).metadata();
		expect(meta.format).toBe('heif');
		expect([meta.width, meta.height]).toEqual([270, 360]);
		expect(meta.exif).toBeUndefined();
		expect(main.background).toBe(true);
		const bg = await sharp(await renderBackdrop(path, LAND, 'webp')).metadata();
		expect(bg.format).toBe('webp');
		expect([bg.width, bg.height]).toEqual([640, 360]);
	});

	it('never upscales small images and fills when aspect matches', async () => {
		const small = addPhoto('s1', await syntheticJpeg(100, 50));
		const m = await sharp((await renderMain(small, LAND, 'webp')).data).metadata();
		expect([m.width, m.height]).toEqual([100, 50]);
		const exact = addPhoto('e', await syntheticJpeg(1280, 720));
		const r = await renderMain(exact, LAND, 'webp');
		expect(r.background).toBe(false);
		expect(r.size).toEqual(LAND);
	});

	it.each([1, 2, 3, 4, 5, 6, 7, 8])('applies EXIF orientation %i', async (o) => {
		const path = addPhoto(`o${o}`, await syntheticJpeg(200, 100, { orientation: o }));
		const { data, size } = await renderMain(path, { width: 400, height: 400 }, 'webp');
		const swapped = o >= 5;
		expect(size).toEqual(swapped ? { width: 100, height: 200 } : { width: 200, height: 100 });
		const meta = await sharp(data).metadata();
		expect([meta.width, meta.height]).toEqual([size.width, size.height]);
	});

	it('handles extreme panoramas', async () => {
		const path = addPhoto('pano', await syntheticJpeg(4000, 20));
		const { size } = await renderMain(path, LAND, 'webp');
		expect(size.width).toBe(640);
		expect(size.height).toBeGreaterThanOrEqual(1);
	});
});

describe('PhotoCache', () => {
	it('renders both formats idempotently and records metadata', async () => {
		addPhoto('a', await syntheticJpeg(300, 400, { takenAt: '2019:05:06 07:08:09' }));
		const first = await cache.ensureRendered('a', LAND);
		expect(first?.background).toBe(true);
		const hit = await cache.cachedVariant('a', LAND, 'avif');
		expect(hit).not.toBeNull();
		const before = statSync(hit!.path).ino;
		const names = new Set<string>();
		for (const part of ['main', 'bg'] as const)
			for (const fmt of ['avif', 'webp'] as const) {
				const v = await cache.cachedVariant('a', LAND, fmt, part);
				expect(v).not.toBeNull();
				names.add(v!.path);
			}
		expect(names.size).toBe(4);
		const second = await cache.ensureRendered('a', LAND);
		expect(second).toEqual(first);
		expect(statSync(hit!.path).ino).toBe(before);
		const row = db.select().from(photos).get();
		expect(row).toMatchObject({
			width: 300,
			height: 400,
			takenAt: Date.UTC(2019, 4, 6, 7, 8, 9)
		});
	});

	it('skips the backdrop when the aspect matches and shares concurrent renders', async () => {
		addPhoto('w', await syntheticJpeg(1280, 720));
		const [a, b] = await Promise.all([
			cache.ensureRendered('w', LAND, ['webp']),
			cache.ensureRendered('w', LAND, ['webp'])
		]);
		expect(a).toBe(b);
		expect(a?.background).toBe(false);
		expect(await cache.cachedVariant('w', LAND, 'webp', 'bg')).toBeNull();
		expect(await cache.cachedVariant('w', LAND, 'avif')).toBeNull();
	});

	it('returns null for unknown or hidden photos and rejects missing files', async () => {
		addPhoto('h', await syntheticJpeg(50, 50), true);
		expect(await cache.ensureRendered('nope', LAND)).toBeNull();
		expect(await cache.ensureRendered('h', LAND)).toBeNull();
		expect(await cache.cachedVariant('h', LAND, 'avif')).toBeNull();
		db.insert(photos)
			.values({ id: 'gone', sourceId: 's', filePath: join(root, 'gone.jpg') })
			.run();
		expect(await cache.cachedVariant('gone', LAND, 'avif')).toBeNull();
		await expect(cache.ensureRendered('gone', LAND)).rejects.toThrow();
	});

	it('evicts least recently used variants when over budget', async () => {
		addPhoto('x', await syntheticJpeg(300, 400));
		addPhoto('y', await syntheticJpeg(310, 400));
		const dir = join(root, 'evict');
		const small = new PhotoCache({ db, dir, maxBytes: 1e9 });
		await small.ensureRendered('x', LAND, ['webp']);
		const old = new Date(Date.now() - 60_000);
		for (const n of readdirSync(dir)) utimesSync(join(dir, n), old, old);
		await small.ensureRendered('y', LAND, ['webp']);
		const keep = readdirSync(dir)
			.filter((n) => statSync(join(dir, n)).mtimeMs > old.getTime() + 1000)
			.map((n) => statSync(join(dir, n)).size)
			.reduce((a, b) => a + b, 0);
		const tight = new PhotoCache({ db, dir, maxBytes: keep });
		expect(await tight.evict()).toBeGreaterThan(0);
		expect(await tight.cachedVariant('x', LAND, 'webp')).toBeNull();
		expect(await tight.cachedVariant('y', LAND, 'webp')).not.toBeNull();
		expect(await new PhotoCache({ db, dir: join(root, 'nodir'), maxBytes: 1 }).evict()).toBe(0);
	});
});
