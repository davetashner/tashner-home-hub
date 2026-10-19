import { describe, expect, it } from 'vitest';
import { ALLOWED_TARGETS } from '#lib/server/domain/photo-fit.js';
import { containRect, isPhotoId, photoSize, photoUrl, thumbUrl } from './drawing-photo.js';

describe('photoSize', () => {
	it('picks the smallest served size that covers the canvas, in its orientation', () => {
		expect(photoSize({ w: 1000, h: 700 })).toEqual({ w: 1920, h: 1080 });
		expect(photoSize({ w: 700, h: 1000 })).toEqual({ w: 1080, h: 1920 });
		expect(photoSize({ w: 2100, h: 1200 })).toEqual({ w: 2560, h: 1440 });
		expect(photoSize({ w: 1000, h: 3000 })).toEqual({ w: 2160, h: 3840 });
		expect(photoSize({ w: 9000, h: 5000 })).toEqual({ w: 3840, h: 2160 });
	});
	it('only ever asks for sizes the photo API serves', () => {
		for (const c of [
			{ w: 1, h: 1 },
			{ w: 1900, h: 900 },
			{ w: 900, h: 1900 },
			{ w: 2500, h: 1000 },
			{ w: 4000, h: 4000 }
		]) {
			const s = photoSize(c);
			expect(ALLOWED_TARGETS.some((t) => t.width === s.w && t.height === s.h)).toBe(true);
		}
	});
});

describe('urls', () => {
	it('builds the cached-copy url', () => {
		expect(photoUrl('a b', { w: 1920, h: 1080 })).toBe('/api/photo/a%20b?w=1920&h=1080&fmt=webp');
	});
	it('uses a portrait thumbnail for a portrait photo', () => {
		expect(thumbUrl('p', 360, 640)).toContain('w=270&h=480');
		expect(thumbUrl('p', 640, 360)).toContain('w=480&h=270');
		expect(thumbUrl('p', null, null)).toContain('w=480&h=270');
		for (const [w, h] of [
			[480, 270],
			[270, 480]
		])
			expect(ALLOWED_TARGETS.some((t) => t.width === w && t.height === h)).toBe(true);
	});
});

describe('isPhotoId', () => {
	it('accepts library ids and rejects anything that could change the url', () => {
		expect(isPhotoId('3f2a-uuid_1')).toBe(true);
		for (const bad of ['', 'a/b', 'a?b', 'x'.repeat(65), 7, null, 'a b'])
			expect(isPhotoId(bad)).toBe(false);
	});
});

describe('containRect', () => {
	it('fits a wide picture on a tall canvas and centres it', () => {
		expect(containRect({ w: 200, h: 100 }, { w: 100, h: 100 })).toEqual({
			x: 0,
			y: 25,
			w: 100,
			h: 50
		});
	});
	it('fits a tall picture on a wide canvas', () => {
		expect(containRect({ w: 100, h: 200 }, { w: 200, h: 100 })).toEqual({
			x: 75,
			y: 0,
			w: 50,
			h: 100
		});
	});
	it('scales a small picture up and tolerates a bad size', () => {
		expect(containRect({ w: 10, h: 10 }, { w: 100, h: 50 })).toEqual({ x: 25, y: 0, w: 50, h: 50 });
		expect(containRect({ w: 0, h: 0 }, { w: 100, h: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 50 });
	});
});
