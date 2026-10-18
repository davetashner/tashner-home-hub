import { describe, expect, it } from 'vitest';
import { parseTarget } from '#lib/server/domain/photo-fit.js';
import {
	advance,
	daySeed,
	DEFAULT_SLIDESHOW,
	DISPLAY_SIZES,
	intervalLabel,
	isIntervalSeconds,
	isTransition,
	kenBurns,
	needsBackdrop,
	shuffle,
	parseSlideshowSettings,
	photoSrc,
	pickTarget,
	stepInterval,
	type SlidePhoto
} from './slideshow.js';

describe('settings', () => {
	it('defaults to 30 seconds and a fade', () => {
		expect(DEFAULT_SLIDESHOW).toEqual({
			intervalSeconds: 30,
			transition: 'fade',
			onThisDay: 'off',
			livePhotos: 'off'
		});
		expect(parseSlideshowSettings({})).toEqual(DEFAULT_SLIDESHOW);
	});

	it('keeps valid values and replaces invalid ones', () => {
		expect(parseSlideshowSettings({ intervalSeconds: 60, transition: 'kenburns' })).toEqual({
			intervalSeconds: 60,
			transition: 'kenburns',
			onThisDay: 'off',
			livePhotos: 'off'
		});
		expect(parseSlideshowSettings({ intervalSeconds: 31, transition: 'spin' })).toEqual(
			DEFAULT_SLIDESHOW
		);
		expect(isIntervalSeconds('30')).toBe(false);
		expect(isTransition(3)).toBe(false);
	});

	it('steps through the allowed intervals and stops at the ends', () => {
		expect(stepInterval(30, 1)).toBe(45);
		expect(stepInterval(30, -1)).toBe(20);
		expect(stepInterval(10, -1)).toBe(10);
		expect(stepInterval(600, 1)).toBe(600);
		expect(stepInterval(25, 1)).toBe(30);
		expect(stepInterval(25, -1)).toBe(20);
		expect(stepInterval(9999, 1)).toBe(600);
		expect(stepInterval(9999, -1)).toBe(300);
	});

	it('labels intervals', () => {
		expect(intervalLabel(15)).toBe('15 seconds');
		expect(intervalLabel(60)).toBe('1 minute');
		expect(intervalLabel(300)).toBe('5 minutes');
	});
});

describe('pickTarget', () => {
	it('only picks sizes the photo API serves', () => {
		for (const s of DISPLAY_SIZES) {
			expect(parseTarget(`${s.width}`, `${s.height}`)).toEqual(s);
			expect(parseTarget(`${s.height}`, `${s.width}`)).toBeDefined();
		}
	});

	it('covers the device pixels in the screen orientation', () => {
		expect(pickTarget(1920, 1080)).toEqual({ width: 1920, height: 1080 });
		expect(pickTarget(1280, 720, 2)).toEqual({ width: 2560, height: 1440 });
		expect(pickTarget(1080, 1920, 2)).toEqual({ width: 2160, height: 3840 });
		expect(pickTarget(800, 600, 0)).toEqual({ width: 1920, height: 1080 });
	});

	it('falls back to the largest size for bigger screens', () => {
		expect(pickTarget(7680, 4320)).toEqual({ width: 3840, height: 2160 });
	});
});

describe('needsBackdrop', () => {
	const landscape = { width: 2560, height: 1440 };
	const portrait = { width: 1440, height: 2560 };
	const photo = (w: number | null, h: number | null): SlidePhoto => ({ id: 'p', w, h });

	it('fills a screen of the same shape edge to edge', () => {
		expect(needsBackdrop(photo(4000, 2250), landscape)).toBe(false);
		expect(needsBackdrop(photo(2250, 4000), portrait)).toBe(false);
	});

	it('puts other shapes on a blurred backdrop instead of cropping', () => {
		expect(needsBackdrop(photo(3000, 4000), landscape)).toBe(true);
		expect(needsBackdrop(photo(4000, 3000), portrait)).toBe(true);
		expect(needsBackdrop(photo(4000, 3000), landscape)).toBe(true);
		expect(needsBackdrop(photo(9000, 2000), landscape)).toBe(true);
	});

	it('asks for a backdrop while the size is unknown', () => {
		expect(needsBackdrop(photo(null, null), landscape)).toBe(true);
	});
});

it('builds photo URLs', () => {
	const t = { width: 1920, height: 1080 };
	expect(photoSrc('a b', t)).toBe('/api/photo/a%20b?w=1920&h=1080&fmt=avif');
	expect(photoSrc('a', t, 'bg')).toBe('/api/photo/a?w=1920&h=1080&fmt=avif&part=bg');
});

describe('advance', () => {
	const list = (...ids: string[]): SlidePhoto[] => ids.map((id) => ({ id, w: 1, h: 1 }));

	it('starts at the first photo', () => {
		expect(advance({ photos: list('a', 'b'), index: -1 })).toMatchObject({
			index: 0,
			wrapped: false
		});
	});

	it('moves through the pass, then wraps to the fresh list', () => {
		const photos = list('a', 'b');
		expect(advance({ photos, index: 0 })).toEqual({ photos, index: 1, wrapped: false });
		const fresh = list('c', 'a');
		expect(advance({ photos, index: 1 }, fresh)).toEqual({
			photos: fresh,
			index: 0,
			wrapped: true
		});
	});

	it('keeps the old list when the fresh one is missing or empty', () => {
		const photos = list('a', 'b');
		expect(advance({ photos, index: 1 }, [])).toEqual({ photos, index: 0, wrapped: true });
	});

	it('never shows the same photo twice in a row across a wrap', () => {
		expect(advance({ photos: list('a', 'b'), index: 1 }, list('b', 'c'))).toMatchObject({
			index: 1
		});
		expect(advance({ photos: list('a'), index: 0 })).toMatchObject({ index: 0, wrapped: true });
	});
});

it('seeds the shuffle by local day', () => {
	expect(daySeed(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
	expect(daySeed(new Date(2026, 11, 25))).toBe('2026-12-25');
});

describe('shuffle', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];

	it('returns every item once, without touching the input', () => {
		const out = shuffle(ids);
		expect([...out].sort()).toEqual(ids);
		expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('follows the random source, so the first photo varies', () => {
		expect(shuffle(ids, () => 0)).toEqual(['b', 'c', 'd', 'e', 'a']);
		expect(shuffle(ids, () => 0.999)).toEqual(ids);
		const firsts = new Set(Array.from({ length: 200 }, () => shuffle(ids)[0]));
		expect(firsts.size).toBeGreaterThan(1);
	});

	it('handles empty and single lists', () => {
		expect(shuffle([])).toEqual([]);
		expect(shuffle(['a'], () => 0)).toEqual(['a']);
	});
});

it('varies the Ken Burns move and only uses transforms', () => {
	const moves = [0, 1, 2, 3, 4, -1].map(kenBurns);
	expect(moves[0].from).toBe('scale(1) translate(0, 0)');
	expect(moves[1].to).toBe('scale(1) translate(0, 0)');
	expect(moves[0].to).not.toBe(moves[2].to);
	expect(moves[4]).toEqual(moves[0]);
	expect(moves[5].from).toContain('scale(1.08)');
	for (const m of moves) expect(`${m.from} ${m.to}`).toMatch(/^[a-z0-9().%,\s-]+$/);
});
