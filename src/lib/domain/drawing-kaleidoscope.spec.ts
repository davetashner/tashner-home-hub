import { describe, expect, it } from 'vitest';
import {
	isKaleidoscopeCount,
	kaleidoscopeGuides,
	kaleidoscopeLabel,
	kaleidoscopeOffset,
	nextKaleidoscope
} from './drawing-kaleidoscope.js';
import {
	centeredKaleidoscope,
	mirrorPoint,
	mirrorPoints,
	mirrorWire,
	parseMirrorWire
} from './drawing-mirror.js';

describe('kaleidoscope modes', () => {
	it('cycles off -> 6 -> 8 -> off', () => {
		expect(nextKaleidoscope(null)).toBe(6);
		expect(nextKaleidoscope(6)).toBe(8);
		expect(nextKaleidoscope(8)).toBeNull();
	});
	it('validates counts and labels them', () => {
		expect(isKaleidoscopeCount(6)).toBe(true);
		expect(isKaleidoscopeCount(8)).toBe(true);
		expect(isKaleidoscopeCount(4)).toBe(false);
		expect(isKaleidoscopeCount('6')).toBe(false);
		expect(kaleidoscopeLabel(null)).toBe('Off');
		expect(kaleidoscopeLabel(6)).toBe('6 slices');
	});
});

describe('kaleidoscope geometry', () => {
	it('copy 0 is the original', () => {
		expect(kaleidoscopeOffset(10, 5, 6, 0)).toEqual({ x: 10, y: 5 });
	});
	it('odd copies reflect, even copies turn', () => {
		const r = kaleidoscopeOffset(10, 5, 8, 1);
		expect(r.x).toBeCloseTo(10);
		expect(r.y).toBeCloseTo(-5);
		const t = kaleidoscopeOffset(10, 0, 8, 2); // 90 degrees
		expect(t.x).toBeCloseTo(0);
		expect(t.y).toBeCloseTo(10);
	});
	it('keeps the distance to the center and gives n distinct points', () => {
		for (const n of [6, 8]) {
			const m = centeredKaleidoscope(n, { w: 200, h: 100 });
			const pts = mirrorPoints(130, 60, m);
			expect(pts).toHaveLength(n);
			for (const p of pts) expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(Math.hypot(30, 10));
			expect(new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(n);
		}
	});
	it('mirrorPoint dispatches to the radial form', () => {
		const m = centeredKaleidoscope(6, { w: 200, h: 100 });
		expect(mirrorPoint(130, 60, m, 0)).toEqual({ x: 130, y: 60 });
		expect(mirrorPoint(150, 50, m, 2).x).toBeCloseTo(100 + 50 * Math.cos((2 * Math.PI) / 3));
	});
	it('guides are n/2 lines through the center', () => {
		const g = kaleidoscopeGuides(6, { w: 200, h: 100 });
		expect(g).toHaveLength(3);
		for (const l of g) {
			expect((l.x1 + l.x2) / 2).toBeCloseTo(100);
			expect((l.y1 + l.y2) / 2).toBeCloseTo(50);
		}
		expect(kaleidoscopeGuides(8, { w: 10, h: 10 })).toHaveLength(4);
	});
});

describe('kaleidoscope wire form', () => {
	const k = centeredKaleidoscope(8, { w: 200, h: 100 });
	it('round-trips with the rot flag and refits the center', () => {
		const wire = mirrorWire(
			k,
			(x) => x,
			(y) => y
		);
		expect(wire).toEqual([8, 100, 50, 1]);
		expect(parseMirrorWire(wire)).toEqual(k);
		expect(
			parseMirrorWire(
				wire,
				(x) => x * 2,
				(y) => y * 2
			)
		).toEqual({ ...k, cx: 200, cy: 100 });
	});
	it('plain mirrors keep the three-number form', () => {
		expect(
			mirrorWire(
				{ n: 4, cx: 1, cy: 2 },
				(x) => x,
				(y) => y
			)
		).toEqual([4, 1, 2]);
		expect(
			mirrorWire(
				undefined,
				(x) => x,
				(y) => y
			)
		).toBeUndefined();
	});
	it('refuses malformed input', () => {
		expect(parseMirrorWire([6, 1, 2])).toBeNull(); // 6 is not a mirror count
		expect(parseMirrorWire([4, 1, 2, 1])).toBeNull(); // 4 is not a kaleidoscope count
		expect(parseMirrorWire([8, 1, 2, 0])).toBeNull();
		expect(parseMirrorWire([8, 1, 2, 1, 9])).toBeNull();
		expect(parseMirrorWire([8, NaN, 2, 1])).toBeNull();
		expect(parseMirrorWire('x')).toBeNull();
		expect(parseMirrorWire(null)).toBeNull();
	});
});
