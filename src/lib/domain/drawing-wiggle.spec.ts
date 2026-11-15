import { describe, expect, it } from 'vitest';
import type { DrawItem, DrawPoint, Shape, Stroke } from './drawing.js';
import {
	WIGGLE_AMPLITUDE,
	WIGGLE_FPS,
	WIGGLE_VARIANTS,
	variantAt,
	wiggleItem,
	wiggleItems,
	wiggleOffset,
	wigglePoints
} from './drawing-wiggle.js';

const pts: DrawPoint[] = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: 100 - i, w: 4 }));
const pen: Stroke = { tool: 'pen', color: 'draw-black', points: pts };
const shape: Shape = {
	shape: 'star',
	color: 'draw-black',
	filled: false,
	width: 4,
	x0: 10,
	y0: 10,
	x1: 90,
	y1: 70
};

describe('wiggleOffset', () => {
	it('is deterministic and bounded', () => {
		for (let item = 0; item < 20; item++)
			for (let v = 0; v < WIGGLE_VARIANTS; v++)
				for (let i = 0; i < 60; i++) {
					const a = wiggleOffset(item, v, i);
					expect(a).toEqual(wiggleOffset(item, v, i));
					expect(Math.abs(a.dx)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
					expect(Math.abs(a.dy)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
				}
	});
	it('differs between variants', () => {
		const offs = [0, 1, 2].map((v) => wiggleOffset(3, v, 4));
		expect(new Set(offs.map((o) => `${o.dx},${o.dy}`)).size).toBe(3);
	});
	it('wraps and survives bad variants', () => {
		expect(wiggleOffset(1, 3, 2)).toEqual(wiggleOffset(1, 0, 2));
		expect(wiggleOffset(1, -1, 2)).toEqual(wiggleOffset(1, 2, 2));
		expect(wiggleOffset(1, NaN, 2)).toEqual(wiggleOffset(1, 0, 2));
	});
	it('respects a smaller amplitude', () => {
		expect(Math.abs(wiggleOffset(1, 1, 7, 0.5).dx)).toBeLessThanOrEqual(0.5);
	});
});

describe('wigglePoints', () => {
	it('keeps the count, width and the input untouched', () => {
		const before = JSON.stringify(pts);
		const out = wigglePoints(pts, 0, 1);
		expect(out).toHaveLength(pts.length);
		expect(out.every((p, i) => p.w === pts[i].w)).toBe(true);
		expect(JSON.stringify(pts)).toBe(before);
	});
	it('moves each point by at most the amplitude', () => {
		wigglePoints(pts, 2, 2).forEach((p, i) => {
			expect(Math.abs(p.x - pts[i].x)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
			expect(Math.abs(p.y - pts[i].y)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
		});
	});
	it('gives the same points for the same variant and different ones otherwise', () => {
		expect(wigglePoints(pts, 0, 1)).toEqual(wigglePoints(pts, 0, 1));
		expect(wigglePoints(pts, 0, 1)).not.toEqual(wigglePoints(pts, 0, 2));
	});
	it('handles an empty line', () => {
		expect(wigglePoints([], 0, 0)).toEqual([]);
	});
});

describe('wiggleItem', () => {
	it('wiggles strokes without changing the stored one', () => {
		const out = wiggleItem(pen, 0, 1) as Stroke;
		expect(out).not.toBe(pen);
		expect(out.points).not.toEqual(pen.points);
		expect(pen.points).toBe(pts);
		expect(out.color).toBe(pen.color);
	});
	it('nudges a shape within bounds', () => {
		const out = wiggleItem(shape, 1, 2) as Shape;
		expect(Math.abs(out.x0 - shape.x0)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
		expect(Math.abs(out.y1 - shape.y1)).toBeLessThanOrEqual(WIGGLE_AMPLITUDE);
		expect(shape.x0).toBe(10);
	});
	it('leaves fills, text and the eraser alone', () => {
		const fill = {
			fill: true,
			color: 'c',
			x: 1,
			y: 1,
			w: 1,
			h: 1,
			tolerance: 1,
			spans: new Uint32Array(0)
		} as DrawItem;
		const text = { text: 'hi', color: 'c', size: 20, x0: 0, y0: 0, x1: 10, y1: 10 } as DrawItem;
		const eraser: Stroke = { ...pen, tool: 'eraser' };
		expect(wiggleItem(fill, 0, 1)).toBe(fill);
		expect(wiggleItem(text, 0, 1)).toBe(text);
		expect(wiggleItem(eraser, 0, 1)).toBe(eraser);
	});
	it('maps a list', () => {
		const out = wiggleItems([pen, shape], 1);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual(wiggleItem(pen, 0, 1));
		expect(out[1]).toEqual(wiggleItem(shape, 1, 1));
	});
});

describe('variantAt', () => {
	it('cycles at the frame rate', () => {
		const step = 1000 / WIGGLE_FPS;
		expect(variantAt(0)).toBe(0);
		expect(variantAt(step + 1)).toBe(1);
		expect(variantAt(step * 2 + 1)).toBe(2);
		expect(variantAt(step * 3 + 1)).toBe(0);
	});
	it('treats bad times as the first variant', () => {
		expect(variantAt(-5)).toBe(0);
		expect(variantAt(NaN)).toBe(0);
	});
});
