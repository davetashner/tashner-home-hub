import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
	fitWithin,
	needsBackground,
	orientedSize,
	parseDimension,
	parseExifTakenAt,
	planRender,
	selectEvictions,
	variantName
} from './photo-fit.js';

const LAND = { width: 2560, height: 1440 };
const PORT = { width: 1440, height: 2560 };

describe('fitWithin', () => {
	it('fits a portrait photo inside a landscape display with bars', () => {
		const fit = fitWithin({ width: 3000, height: 4000 }, LAND);
		expect(fit).toEqual({ width: 1080, height: 1440 });
		expect(needsBackground(fit, LAND)).toBe(true);
	});
	it('fits a landscape photo inside a portrait display', () => {
		const fit = fitWithin({ width: 4000, height: 3000 }, PORT);
		expect(fit).toEqual({ width: 1440, height: 1080 });
		expect(needsBackground(fit, PORT)).toBe(true);
	});
	it('never upscales small images', () => {
		const fit = fitWithin({ width: 800, height: 600 }, LAND);
		expect(fit).toEqual({ width: 800, height: 600 });
		expect(needsBackground(fit, LAND)).toBe(true);
	});
	it('fills exactly when the aspect matches (no backdrop)', () => {
		const fit = fitWithin({ width: 6000, height: 3375 }, LAND);
		expect(fit).toEqual(LAND);
		expect(needsBackground(fit, LAND)).toBe(false);
	});
	it('tolerates rounding-level differences', () => {
		expect(needsBackground({ width: 2559, height: 1440 }, LAND)).toBe(false);
	});
	it('keeps at least 1px on extreme panoramas', () => {
		const fit = fitWithin({ width: 100000, height: 10 }, LAND);
		expect(fit.width).toBe(2560);
		expect(fit.height).toBe(1);
		expect(fitWithin({ width: 10, height: 100000 }, LAND)).toEqual({ width: 1, height: 1440 });
	});
	it('rejects invalid sources', () => {
		expect(() => fitWithin({ width: 0, height: 5 }, LAND)).toThrow(RangeError);
	});
});

describe('orientation', () => {
	it.each([1, 2, 3, 4, undefined])('keeps dimensions for orientation %s', (o) => {
		expect(orientedSize({ width: 400, height: 300 }, o)).toEqual({ width: 400, height: 300 });
	});
	it.each([5, 6, 7, 8])('swaps dimensions for orientation %s', (o) => {
		expect(orientedSize({ width: 400, height: 300 }, o)).toEqual({ width: 300, height: 400 });
	});
	it('plans using the rotated size', () => {
		const plan = planRender({ width: 4000, height: 3000 }, 6, LAND);
		expect(plan.main).toEqual({ width: 1080, height: 1440 });
		expect(plan.background).toBe(true);
	});
});

describe('parseDimension / variantName', () => {
	it('accepts only sane integers', () => {
		expect(parseDimension('2560')).toBe(2560);
		expect(parseDimension(null)).toBeUndefined();
		expect(parseDimension(undefined)).toBeUndefined();
		expect(parseDimension('abc')).toBeUndefined();
		expect(parseDimension('10')).toBeUndefined();
		expect(parseDimension('9000')).toBeUndefined();
		expect(parseDimension('12.5')).toBeUndefined();
	});
	it('names variants deterministically', () => {
		expect(variantName('abc', LAND, 'bg', 'webp')).toBe('abc-2560x1440-bg.webp');
	});
});

describe('selectEvictions', () => {
	const e = (key: string, size: number, usedAt: number) => ({ key, size, usedAt });
	it('evicts nothing under budget', () => {
		expect(selectEvictions([e('a', 10, 1)], 10)).toEqual([]);
	});
	it('evicts least recently used first until under budget', () => {
		const entries = [e('new', 50, 300), e('old', 50, 100), e('mid', 50, 200)];
		expect(selectEvictions(entries, 100)).toEqual(['old']);
		expect(selectEvictions(entries, 50)).toEqual(['old', 'mid']);
		expect(selectEvictions(entries, 0)).toEqual(['old', 'mid', 'new']);
	});
	it('breaks ties by key and does not mutate input', () => {
		const entries = [e('b', 10, 1), e('a', 10, 1)];
		expect(selectEvictions(entries, 10)).toEqual(['a']);
		expect(entries[0].key).toBe('b');
	});
});

describe('parseExifTakenAt', () => {
	it('reads DateTimeOriginal from sharp-written EXIF', async () => {
		const jpeg = await sharp({
			create: { width: 8, height: 8, channels: 3, background: '#468' }
		})
			.withExif({ IFD2: { DateTimeOriginal: '2021:07:04 10:20:30' } })
			.jpeg()
			.toBuffer();
		const { exif } = await sharp(jpeg).metadata();
		expect(parseExifTakenAt(exif)).toBe(Date.UTC(2021, 6, 4, 10, 20, 30));
	});
	it('reads big-endian blocks', () => {
		// Hand-built MM TIFF: IFD0 -> ExifIFD pointer -> DateTimeOriginal at offset 0x4A.
		const b = Buffer.alloc(0x4a + 20);
		b.write('MM', 0);
		b.writeUInt16BE(42, 2);
		b.writeUInt32BE(8, 4);
		b.writeUInt16BE(1, 8);
		b.writeUInt16BE(0x8769, 10);
		b.writeUInt16BE(4, 12);
		b.writeUInt32BE(1, 14);
		b.writeUInt32BE(26, 18);
		b.writeUInt16BE(1, 26);
		b.writeUInt16BE(0x9003, 28);
		b.writeUInt16BE(2, 30);
		b.writeUInt32BE(20, 32);
		b.writeUInt32BE(0x4a, 36);
		b.write('1999:12:31 23:59:58', 0x4a, 'latin1');
		expect(parseExifTakenAt(b)).toBe(Date.UTC(1999, 11, 31, 23, 59, 58));
	});
	it('returns undefined for missing or malformed data', async () => {
		expect(parseExifTakenAt(undefined)).toBeUndefined();
		expect(parseExifTakenAt(Buffer.alloc(4))).toBeUndefined();
		expect(parseExifTakenAt(Buffer.alloc(40))).toBeUndefined();
		expect(parseExifTakenAt(Buffer.from('Exif\0\0ZZ\0\0\0\0\0\0\0\0\0\0'))).toBeUndefined();
		const noDate = await sharp({
			create: { width: 8, height: 8, channels: 3, background: '#468' }
		})
			.withExif({ IFD0: { Copyright: 'x' } })
			.jpeg()
			.toBuffer();
		expect(parseExifTakenAt((await sharp(noDate).metadata()).exif)).toBeUndefined();
		const bad = await sharp({
			create: { width: 8, height: 8, channels: 3, background: '#468' }
		})
			.withExif({ IFD2: { DateTimeOriginal: 'not a date at all' } })
			.jpeg()
			.toBuffer();
		expect(parseExifTakenAt((await sharp(bad).metadata()).exif)).toBeUndefined();
	});
	it('rejects out-of-range dates', async () => {
		const jpeg = await sharp({
			create: { width: 8, height: 8, channels: 3, background: '#468' }
		})
			.withExif({ IFD2: { DateTimeOriginal: '2021:13:40 10:20:30' } })
			.jpeg()
			.toBuffer();
		expect(parseExifTakenAt((await sharp(jpeg).metadata()).exif)).toBeUndefined();
	});
});
