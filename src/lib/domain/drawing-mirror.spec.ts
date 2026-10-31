import { describe, expect, it } from 'vitest';
import {
	centeredMirror,
	isMirrorCount,
	mirrorGuides,
	mirrorLabel,
	mirrorPoint,
	mirrorPoints,
	mirrorWire,
	nextMirror,
	parseMirrorWire
} from './drawing-mirror.js';

const m8 = { n: 8 as const, cx: 100, cy: 50 };

describe('drawing-mirror', () => {
	it('cycles off, 2, 4, 8, off', () => {
		expect(nextMirror(null)).toBe(2);
		expect(nextMirror(2)).toBe(4);
		expect(nextMirror(4)).toBe(8);
		expect(nextMirror(8)).toBeNull();
		expect(mirrorLabel(null)).toBe('Off');
		expect(mirrorLabel(2)).toBe('2-way');
		expect(mirrorLabel(4)).toBe('4-way');
		expect(mirrorLabel(8)).toBe('8-way');
	});

	it('reflects left/right for 2-way and keeps the original first', () => {
		const pts = mirrorPoints(130, 60, { n: 2, cx: 100, cy: 50 });
		expect(pts).toEqual([
			{ x: 130, y: 60 },
			{ x: 70, y: 60 }
		]);
	});

	it('adds up/down for 4-way', () => {
		const pts = mirrorPoints(130, 60, { n: 4, cx: 100, cy: 50 });
		expect(pts).toContainEqual({ x: 130, y: 40 });
		expect(pts).toContainEqual({ x: 70, y: 40 });
		expect(pts).toHaveLength(4);
	});

	it('8-way gives eight distinct points all equidistant from the center', () => {
		const pts = mirrorPoints(130, 60, m8);
		expect(pts).toHaveLength(8);
		expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(8);
		for (const p of pts) expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(Math.hypot(30, 10));
		expect(mirrorPoint(130, 60, m8, 4)).toEqual({ x: 110, y: 80 });
	});

	it('a point on the center is its own reflection', () => {
		for (const p of mirrorPoints(100, 50, m8)) expect(p).toEqual({ x: 100, y: 50 });
	});

	it('centers on the board and draws guides per mode', () => {
		expect(centeredMirror(4, { w: 200, h: 100 })).toEqual({ n: 4, cx: 100, cy: 50 });
		expect(mirrorGuides(2, { w: 200, h: 100 })).toHaveLength(1);
		expect(mirrorGuides(4, { w: 200, h: 100 })).toHaveLength(2);
		expect(mirrorGuides(8, { w: 200, h: 100 })).toHaveLength(4);
	});

	it('round-trips the wire form and rejects junk', () => {
		const w = mirrorWire(
			m8,
			(x) => x / 2,
			(y) => y / 2
		);
		expect(w).toEqual([8, 50, 25]);
		expect(
			parseMirrorWire(
				w,
				(x) => x * 2,
				(y) => y * 2
			)
		).toEqual(m8);
		expect(parseMirrorWire(w)).toEqual({ n: 8, cx: 50, cy: 25 });
		expect(
			mirrorWire(
				undefined,
				(x) => x,
				(y) => y
			)
		).toBeUndefined();
		for (const bad of [null, [3, 1, 1], [2, 1], [2, 'a', 1], [2, 1, NaN], 'x'])
			expect(parseMirrorWire(bad)).toBeNull();
		expect(isMirrorCount(4)).toBe(true);
		expect(isMirrorCount(3)).toBe(false);
	});
});
