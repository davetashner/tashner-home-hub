import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { syntheticJpeg } from '../photo-cache/fixtures.js';
import { forgetSource, lastScan, scanSource } from './folder.js';
import { PhotoSourceError, resolvePhotoPath, validateRoot } from './paths.js';
import { prerenderTargets } from './prerender.js';
import { listSourceViews, slideshow, viewSource } from './service.js';

const base = mkdtempSync(join(tmpdir(), 'hub-folder-'));
const root = join(base, 'allowed', 'lib');
const outside = join(base, 'secret');
process.env.HUB_PHOTO_ROOTS = join(base, 'allowed');
let db: Db;
let jpg: Buffer;
const put = (rel: string, data: Buffer | string = jpg) => {
	const full = join(root, rel);
	mkdirSync(join(full, '..'), { recursive: true });
	writeFileSync(full, data);
};
const paths = () =>
	db
		.select()
		.from(schema.photos)
		.all()
		.map((p) => p.filePath)
		.sort();

beforeAll(async () => {
	jpg = await syntheticJpeg(60, 40);
	db = openDb(':memory:');
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(outside, 'x.jpg'), jpg);
	put('top.jpg');
	put('Trip/a.JPG');
	put('Trip/deep/b.png');
	put('Pets/c.jpg');
	put('.DS_Store', 'x');
	put('Trip/clip.mov', 'x');
	put('Trip/a.jpg.xmp', 'x');
	put('.hidden/z.jpg');
	symlinkSync(outside, join(root, 'link'));
	symlinkSync(join(outside, 'x.jpg'), join(root, 'Pets', 'ln.jpg'));
	db.insert(schema.photoSources)
		.values({ id: 's', kind: 'folder', label: 'T', config: JSON.stringify({ root, albums: [] }) })
		.run();
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('validateRoot', () => {
	it('accepts the root and resolves symlinks', async () => {
		expect(await validateRoot(root)).toContain('lib');
	});
	it('rejects relative, missing, files, outside and symlink escapes', async () => {
		for (const bad of [
			'relative/dir',
			undefined,
			join(root, 'nope'),
			join(root, 'top.jpg'),
			outside,
			join(root, '..', '..', 'secret'),
			join(root, 'link'),
			'/etc'
		])
			await expect(validateRoot(bad), String(bad)).rejects.toBeInstanceOf(PhotoSourceError);
	});
});

describe('scanSource', () => {
	it('finds supported images only, with albums, skipping symlinks and dotfiles', async () => {
		const r = await scanSource(db, 's');
		expect(r.total).toBe(4);
		expect(r.added).toHaveLength(4);
		expect(paths()).toEqual(['Pets/c.jpg', 'Trip/a.JPG', 'Trip/deep/b.png', 'top.jpg']);
		const albums = viewSource(db, 's')!.albums;
		expect(albums).toEqual([
			{ name: '(root)', count: 1, selected: true },
			{ name: 'Pets', count: 1, selected: true },
			{ name: 'Trip', count: 2, selected: true }
		]);
		expect(lastScan(db, 's')?.count).toBe(4);
	});

	it('adds, modifies, removes; hidden survives', async () => {
		const row = db.select().from(schema.photos).where(eq(schema.photos.filePath, 'top.jpg')).get()!;
		db.update(schema.photos)
			.set({ hidden: true, width: 1, height: 1 })
			.where(eq(schema.photos.id, row.id))
			.run();
		put('new.jpg');
		rmSync(join(root, 'Pets/c.jpg'));
		const future = new Date(Date.now() + 60_000);
		utimesSync(join(root, 'top.jpg'), future, future);
		const r = await scanSource(db, 's');
		expect(r.added).toHaveLength(1);
		expect(r.removed).toBe(1);
		expect(r.changed).toEqual([row.id]);
		const after = db.select().from(schema.photos).where(eq(schema.photos.id, row.id)).get()!;
		expect(after.hidden).toBe(true);
		expect(after.width).toBeNull();
		expect(paths()).not.toContain('Pets/c.jpg');
		expect(paths()).toContain('new.jpg');
		const again = await scanSource(db, 's');
		expect([again.added.length, again.removed, again.changed.length]).toEqual([0, 0, 0]);
	});

	it('shares one run between concurrent calls and rejects unknown sources', async () => {
		const first = scanSource(db, 's');
		expect(scanSource(db, 's')).toBe(first);
		await first; // never leave a scan running past the test: afterAll deletes its folder
		await expect(scanSource(db, 'missing')).rejects.toBeInstanceOf(PhotoSourceError);
	});

	it('refuses to scan a root that is no longer allowed', async () => {
		db.insert(schema.photoSources)
			.values({ id: 'bad', kind: 'folder', label: 'B', config: JSON.stringify({ root: outside }) })
			.run();
		await expect(scanSource(db, 'bad')).rejects.toBeInstanceOf(PhotoSourceError);
	});
});

describe('slideshow and views', () => {
	it('excludes hidden photos and unselected albums, stable per seed', () => {
		const all = slideshow(db, 100, 'x');
		expect(all.map((p) => p.id)).toEqual(slideshow(db, 100, 'x').map((p) => p.id));
		expect(all).toHaveLength(3);
		db.update(schema.photoSources)
			.set({ config: JSON.stringify({ root, albums: ['Trip'] }) })
			.run();
		expect(slideshow(db, 100).every((p) => p.album === 'Trip')).toBe(true);
		expect(slideshow(db, 1)).toHaveLength(1);
		expect(
			listSourceViews(db)
				.find((s) => s.id === 's')!
				.albums.map((a) => a.selected)
		).toEqual([false, true]);
	});
	it('forgetSource clears the status', () => {
		forgetSource(db, 's');
		expect(lastScan(db, 's')).toBeNull();
	});
});

describe('resolvePhotoPath', () => {
	const photo = (filePath: string) =>
		({ id: 'p', sourceId: 's', filePath }) as typeof schema.photos.$inferSelect;
	it('joins under the root and refuses traversal', () => {
		expect(resolvePhotoPath(db, photo('Trip/a.JPG'))).toBe(join(root, 'Trip/a.JPG'));
		expect(() => resolvePhotoPath(db, photo('../../secret/x.jpg'))).toThrow(PhotoSourceError);
		expect(() => resolvePhotoPath(db, photo('/etc/passwd'))).toThrow(PhotoSourceError);
	});
	it('falls back to absolute / cwd-relative paths for sources without a root', () => {
		db.insert(schema.photoSources).values({ id: 'o', kind: 'other', label: 'o' }).run();
		const p = { ...photo('/abs/x.jpg'), sourceId: 'o' };
		expect(resolvePhotoPath(db, p)).toBe('/abs/x.jpg');
		expect(resolvePhotoPath(db, { ...p, filePath: 'rel/x.jpg' })).toBe(
			join(process.cwd(), 'rel/x.jpg')
		);
	});
});

describe('prerenderTargets', () => {
	it('adds the portrait swap only for a portrait display', () => {
		expect(prerenderTargets(db)).toEqual([{ width: 2560, height: 1440 }]);
		db.insert(schema.settings).values({ key: 'display.orientation', value: '"portrait"' }).run();
		expect(prerenderTargets(db)).toHaveLength(2);
		db.update(schema.settings).set({ value: '{bad' }).run();
		expect(prerenderTargets(db)).toHaveLength(1);
	});
});
