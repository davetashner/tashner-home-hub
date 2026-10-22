import { describe, expect, it } from 'vitest';
import { MAX_PULL, MIN_PULL } from './pull.js';
import {
	GRAB_RADIUS_PX,
	VIEW_MARGIN,
	canGrab,
	fitCamera,
	pullFromPointer,
	releasePull,
	renderSize,
	toScreen,
	toWorld
} from './view.js';

const level = { width: 30, height: 15 };

describe('fitCamera', () => {
	it('is limited by height in a wide canvas and centres the level', () => {
		const cam = fitCamera(level, 1600, 400);
		expect(cam.scale).toBeCloseTo(400 / (15 + 2 * VIEW_MARGIN));
		expect(cam.ox).toBeCloseTo((1600 - 30 * cam.scale) / 2);
		expect(cam.oy).toBeCloseTo(400 - VIEW_MARGIN * cam.scale);
	});

	it('is limited by width in a portrait canvas and keeps the ground at the bottom', () => {
		const cam = fitCamera(level, 600, 1000);
		expect(cam.scale).toBeCloseTo(600 / (30 + 2 * VIEW_MARGIN));
		expect(cam.ox).toBeCloseTo(VIEW_MARGIN * cam.scale);
		expect(cam.oy).toBeCloseTo(1000 - VIEW_MARGIN * cam.scale);
		expect(toScreen(cam, { x: 0, y: 15 }).y).toBeGreaterThan(0);
	});

	it('keeps the whole level on screen at any aspect', () => {
		for (const [w, h] of [
			[1920, 1080],
			[1080, 1920],
			[300, 300],
			[2000, 200]
		] as const) {
			const cam = fitCamera(level, w, h);
			const tl = toScreen(cam, { x: 0, y: level.height });
			const br = toScreen(cam, { x: level.width, y: 0 });
			expect(tl.x).toBeGreaterThanOrEqual(0);
			expect(tl.y).toBeGreaterThanOrEqual(0);
			expect(br.x).toBeLessThanOrEqual(w + 1e-6);
			expect(br.y).toBeLessThanOrEqual(h + 1e-6);
		}
	});
});

describe('toScreen and toWorld', () => {
	const cam = fitCamera(level, 1280, 720);
	it('flips y and round-trips', () => {
		const p = { x: 7.5, y: 3.25 };
		const back = toWorld(cam, toScreen(cam, p));
		expect(back.x).toBeCloseTo(p.x);
		expect(back.y).toBeCloseTo(p.y);
		expect(toScreen(cam, { x: 0, y: 4 }).y).toBeLessThan(toScreen(cam, { x: 0, y: 0 }).y);
	});
});

describe('slingshot pulling', () => {
	const cam = fitCamera(level, 1280, 720);
	const anchor = { x: 4, y: 3 };
	const at = toScreen(cam, anchor);

	it('grabs only near the pouch', () => {
		expect(canGrab(cam, anchor, at)).toBe(true);
		expect(canGrab(cam, anchor, { x: at.x + GRAB_RADIUS_PX - 1, y: at.y })).toBe(true);
		expect(canGrab(cam, anchor, { x: at.x + GRAB_RADIUS_PX + 1, y: at.y })).toBe(false);
	});

	it('pulls back and down in world metres', () => {
		const pull = pullFromPointer(cam, anchor, { x: at.x - cam.scale, y: at.y + cam.scale });
		expect(pull.x).toBeCloseTo(-1);
		expect(pull.y).toBeCloseTo(-1);
	});

	it('clamps a long drag to the band reach', () => {
		const pull = pullFromPointer(cam, anchor, { x: at.x - 10 * cam.scale, y: at.y });
		expect(Math.hypot(pull.x, pull.y)).toBeCloseTo(MAX_PULL);
	});

	it('cancels a release at the pouch and fires a real pull', () => {
		expect(releasePull({ x: 0, y: 0 })).toBeNull();
		expect(releasePull({ x: -MIN_PULL / 2, y: 0 })).toBeNull();
		const pull = { x: -1, y: -0.5 };
		expect(releasePull(pull)).toEqual(pull);
	});
});

describe('renderSize', () => {
	it('uses device pixels when small enough', () => {
		expect(renderSize(800, 600, 2)).toEqual({ width: 1600, height: 1200, ratio: 2 });
	});
	it('caps the backing width and keeps the aspect', () => {
		const s = renderSize(1920, 1080, 2);
		expect(s.width).toBe(1920);
		expect(s.height).toBe(1080);
		expect(s.ratio).toBe(1);
	});
});
