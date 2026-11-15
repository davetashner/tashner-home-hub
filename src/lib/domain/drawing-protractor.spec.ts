import { describe, expect, it } from 'vitest';
import {
	aimAngle,
	aimProtractor,
	clampProtractor,
	defaultProtractor,
	moveProtractor,
	nearCenter,
	pointOnRay,
	protractorMarks,
	rotateProtractor,
	snapAngle,
	type Protractor
} from './drawing-protractor.js';

const D = Math.PI / 180;
const p: Protractor = { cx: 500, cy: 400, angle: 0, r: 480 };

describe('snapAngle', () => {
	it('rounds to the nearest 15 degrees', () => {
		expect(snapAngle(20 * D) / D).toBeCloseTo(15);
		expect(snapAngle(23 * D) / D).toBeCloseTo(30);
		expect(snapAngle(-50 * D) / D).toBeCloseTo(-45);
		expect(snapAngle(179 * D) / D).toBeCloseTo(180);
	});
	it('counts from the protractor baseline', () => {
		expect(snapAngle(50 * D, 15, 10 * D) / D).toBeCloseTo(55);
	});
	it('survives junk', () => {
		expect(snapAngle(NaN)).toBe(0);
		expect(snapAngle(Infinity, 15, 1)).toBeCloseTo(1);
		expect(snapAngle(31 * D, 0) / D).toBeCloseTo(30);
		expect(snapAngle(31 * D, -5) / D).toBeCloseTo(30);
		expect(snapAngle(31 * D, 15, NaN) / D).toBeCloseTo(30);
	});
});

describe('aimAngle', () => {
	it('is undecided while the pen is near the center', () => {
		expect(aimAngle(p, { x: 505, y: 402 })).toBeNull();
		expect(aimAngle(p, { x: NaN, y: 0 })).toBeNull();
	});
	it('snaps a wobbly direction', () => {
		const a = aimAngle(p, { x: 500 + 300, y: 400 - 100 }); // about -18.4 degrees
		expect(a! / D).toBeCloseTo(-15);
	});
	it('follows a turned protractor', () => {
		const q = { ...p, angle: 10 * D };
		const a = aimAngle(q, { x: 500 + 200, y: 400 });
		expect(a! / D).toBeCloseTo(-5); // marks sit at 10 + k*15
	});
});

describe('pointOnRay', () => {
	it('puts points on the ray, never behind the center', () => {
		const q = pointOnRay(p, 0, { x: 700, y: 480 });
		expect(q).toEqual({ x: 700, y: 400 });
		expect(pointOnRay(p, 0, { x: 300, y: 400 })).toEqual({ x: 500, y: 400 });
	});
	it('works on a diagonal', () => {
		const q = pointOnRay(p, 45 * D, { x: 600, y: 400 });
		expect(q.x - 500).toBeCloseTo(q.y - 400);
	});
});

describe('geometry helpers', () => {
	it('detects the center', () => {
		expect(nearCenter(p, { x: 520, y: 410 })).toBe(true);
		expect(nearCenter(p, { x: 900, y: 400 })).toBe(false);
		expect(nearCenter(p, { x: NaN, y: 0 })).toBe(false);
	});
	it('moves, rotates and aims', () => {
		expect(moveProtractor(p, 10, -5)).toMatchObject({ cx: 510, cy: 395 });
		expect(moveProtractor(p, NaN, 3)).toMatchObject({ cx: 500, cy: 403 });
		expect(rotateProtractor(p, Math.PI * 3).angle).toBeCloseTo(Math.PI);
		expect(rotateProtractor(p, NaN).angle).toBe(0);
		expect(aimProtractor(p, { x: 500, y: 600 }).angle).toBeCloseTo(Math.PI / 2);
		expect(aimProtractor(p, { x: 500, y: 400 })).toBe(p);
		expect(aimProtractor(p, { x: NaN, y: 1 })).toBe(p);
	});
	it('clamps onto the board', () => {
		const c = clampProtractor({ ...p, cx: -50, cy: 9999, angle: 7 }, { w: 1000, h: 800 });
		expect(c.cx).toBe(0);
		expect(c.cy).toBe(800);
		expect(c.angle).toBeLessThanOrEqual(Math.PI);
		const bad = clampProtractor({ ...p, cx: NaN, cy: NaN, angle: NaN }, { w: 1000, h: 800 });
		expect(bad).toMatchObject({ cx: 500, cy: 400, angle: 0 });
		expect(clampProtractor(p, { w: NaN, h: -1 })).toMatchObject({ cx: 0, cy: 0 });
	});
	it('starts sized to the board', () => {
		expect(defaultProtractor({ w: 3000, h: 2000 })).toMatchObject({ cx: 1500, cy: 1200, r: 480 });
		expect(defaultProtractor({ w: 500, h: 500 }).r).toBe(200);
		expect(defaultProtractor({ w: 0, h: NaN }).r).toBeGreaterThan(0);
	});
	it('has 37 marks, every third labelled', () => {
		const m = protractorMarks();
		expect(m).toHaveLength(37);
		expect(m.filter((x) => x.label).map((x) => x.deg)).toEqual([
			0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180
		]);
	});
});
