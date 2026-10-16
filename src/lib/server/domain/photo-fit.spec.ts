import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
	fitWithin,
	needsBackground,
	orientedSize,
	parseTarget,
	parseExifTakenAt,
	selectEvictions
} from './photo-fit.js';

const tiny = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#468' } });
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
	it('keeps at least 1px on extreme panoramas', () => {
		const fit = fitWithin({ width: 100000, height: 10 }, LAND);
		expect(fit.width).toBe(2560);
		expect(fit.height).toBe(1);
		expect(fitWithin({ width: 10, height: 100000 }, LAND)).toEqual({ width: 1, height: 1440 });
	});
});

it('rejects invalid sources', () => {
	expect(() => fitWithin({ width: 0, height: 5 }, LAND)).toThrow(RangeError);
});

describe('orientation', () => {
	it.each([
		[undefined, false],
		[1, false],
		[2, false],
		[3, false],
		[4, false],
		[5, true],
		[6, true],
		[7, true],
		[8, true]
	])('orientation %s swaps dimensions: %s', (o, swaps) => {
		const size = orientedSize({ width: 400, height: 300 }, o);
		expect(size).toEqual(swaps ? { width: 300, height: 400 } : { width: 400, height: 300 });
	});
});

describe('parseTarget', () => {
	it('accepts only allowlisted sizes, including portrait swaps', () => {
		expect(parseTarget(null, null)).toEqual(LAND);
		expect(parseTarget('1440', '2560')).toEqual(PORT);
		expect(parseTarget('270', '480')).toEqual({ width: 270, height: 480 });
		expect(parseTarget('2561', '1440') ?? parseTarget('2560', null)).toBeUndefined();
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
});

describe('parseExifTakenAt', () => {
	it('reads DateTimeOriginal from sharp-written EXIF', async () => {
		const jpeg = await tiny()
			.withExif({ IFD2: { DateTimeOriginal: '2021:07:04 10:20:30' } })
			.jpeg()
			.toBuffer();
		const { exif } = await sharp(jpeg).metadata();
		expect(parseExifTakenAt(exif)).toBe(Date.UTC(2021, 6, 4, 10, 20, 30));
	});
	it('returns undefined for missing, malformed or out-of-range data', async () => {
		expect(parseExifTakenAt(undefined)).toBeUndefined();
		expect(parseExifTakenAt(Buffer.alloc(4))).toBeUndefined();
		expect(parseExifTakenAt(Buffer.alloc(40))).toBeUndefined();
		for (const exif of [
			{ IFD0: { Copyright: 'x' } },
			{ IFD2: { DateTimeOriginal: 'nope' } },
			{ IFD2: { DateTimeOriginal: '2021:13:40 10:20:30' } }
		]) {
			const jpeg = await tiny().withExif(exif).jpeg().toBuffer();
			expect(parseExifTakenAt((await sharp(jpeg).metadata()).exif)).toBeUndefined();
		}
	});
});
