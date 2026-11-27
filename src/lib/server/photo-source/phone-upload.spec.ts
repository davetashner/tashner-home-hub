import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { parseExifTakenAt } from '../domain/photo-fit.js';
import { syntheticJpeg } from '../photo-cache/fixtures.js';

vi.mock('./prerender.js', async (orig) => ({
	...(await orig<typeof import('./prerender.js')>()),
	enqueuePrerender: vi.fn()
}));
const { UploadError, ensureUploadSource, normalizePhoto, saveUpload } =
	await import('./phone-upload.js');

const base = mkdtempSync(join(tmpdir(), 'hub-upload-'));
// The folder scan checks roots against process.env, so the test data dir goes there too.
process.env.DATA_DIR = base;
process.env.HUB_PHOTO_ROOTS = '/nonexistent';
const env = process.env;
const album = join(base, 'photo-library', '.phone-uploads', 'From phones');
let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
	rmSync(join(base, 'photo-library'), { recursive: true, force: true });
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('normalizePhoto', () => {
	it('turns the photo upright and keeps only the capture time', async () => {
		const src = await sharp(await syntheticJpeg(40, 20, { orientation: 6 }))
			.withExif({
				IFD0: { Make: 'Synthetic', Model: 'Fixture' },
				IFD2: { DateTimeOriginal: '2021:03:04 05:06:07' },
				IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1' }
			})
			.jpeg()
			.toBuffer();
		const out = await normalizePhoto(src);
		const meta = await sharp(out).metadata();
		expect(meta.format).toBe('jpeg');
		expect([meta.width, meta.height, meta.orientation ?? 1]).toEqual([20, 40, 1]);
		expect(parseExifTakenAt(meta.exif)).toBe(Date.UTC(2021, 2, 4, 5, 6, 7));
		const text = meta.exif?.toString('latin1') ?? '';
		expect(text).not.toContain('Synthetic');
		expect(text).not.toContain('GPS');
		expect(meta.exif?.includes(Buffer.from([0x88, 0x25]))).toBe(false);
	});

	it('drops all metadata when there is no capture time, and shrinks huge photos', async () => {
		const src = await sharp({
			create: { width: 5000, height: 100, channels: 3, background: 'red' }
		})
			.png()
			.toBuffer();
		const meta = await sharp(await normalizePhoto(src)).metadata();
		expect([meta.width, meta.exif]).toEqual([4096, undefined]);
	});

	it('refuses bytes that are not a readable image', async () => {
		const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
		await expect(normalizePhoto(broken)).rejects.toBeInstanceOf(UploadError);
	});
});

describe('saveUpload', () => {
	it('stores photos in one "From phones" source and adds them to the library', async () => {
		const jpg = await syntheticJpeg(60, 40);
		const [a, b] = await Promise.all([
			saveUpload(db, jpg, { env, now: () => 1000 }),
			saveUpload(db, jpg, { env, now: () => 2000 })
		]);
		expect(a.sourceId).toBe(b.sourceId);
		expect([a.photoId, b.photoId].every((id) => typeof id === 'string')).toBe(true);
		const sources = db.select().from(schema.photoSources).all();
		expect(sources.map((s) => [s.kind, s.label])).toEqual([['folder', 'From phones']]);
		expect(readdirSync(album).sort()).toEqual([a.file, b.file].sort());
		expect(a.file).toMatch(/^phone-1000-[a-f0-9]{12}\.jpg$/);
		const rows = db.select().from(schema.photos).all();
		expect(rows.map((r) => r.album)).toEqual(['From phones', 'From phones']);
		expect(readFileSync(join(album, a.file)).subarray(0, 3)).toEqual(
			Buffer.from([0xff, 0xd8, 0xff])
		);
	});

	it('reuses the source after a restart and refuses non-photos', async () => {
		const id = await ensureUploadSource(db, env);
		expect(await ensureUploadSource(db, env)).toBe(id);
		await expect(saveUpload(db, Buffer.from('not a photo at all'), { env })).rejects.toThrow(
			/not a photo/
		);
		expect(readdirSync(album)).toEqual([]);
	});
});
