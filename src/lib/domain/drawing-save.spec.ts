import { describe, expect, it } from 'vitest';
import { makeFill } from './drawing-fill.js';
import {
	FILL_REF,
	SAVED_MAX_CHARS,
	SAVED_MAX_ITEMS,
	SAVED_MAX_POINTS,
	isSavedDrawing,
	loadDrawing,
	savedSize,
	serializeDrawing
} from './drawing-save.js';
import { isShape, type DrawItem, type Shape, type Stroke } from './drawing.js';
import { isFill } from './drawing-fill.js';

const stroke: Stroke = {
	tool: 'pen',
	color: 'draw-red',
	points: [
		{ x: 10.04, y: 20, w: 7 },
		{ x: 30, y: 40, w: 8 }
	]
};
const shape: Shape = {
	shape: 'star',
	color: 'draw-blue',
	filled: true,
	width: 7,
	x0: 10,
	y0: 10,
	x1: 50,
	y1: 60
};
const fill = makeFill(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4, 2, 2, 'draw-green')!;
const size = { w: 400, h: 200 };

describe('saved drawing round trip', () => {
	it('keeps strokes, shapes and fill seeds', () => {
		const json = serializeDrawing([stroke, shape, fill], size, 2);
		expect(isSavedDrawing(json)).toBe(true);
		expect(savedSize(json)).toEqual(size);
		const [a, b, c] = loadDrawing(json, size) as [Stroke, Shape, DrawItem];
		expect(a.points).toEqual([
			{ x: 10, y: 20, w: 7 },
			{ x: 30, y: 40, w: 8 }
		]);
		expect(a).toMatchObject({ tool: 'pen', color: 'draw-red' });
		expect(isShape(b) && b).toMatchObject({ shape: 'star', filled: true, x1: 50 });
		expect(isFill(c) && c).toMatchObject({ color: 'draw-green', w: FILL_REF, h: FILL_REF });
		// Seed (2, 2) device px at 2x is (1, 1) css px, a quarter-percent of the 400x200 canvas.
		expect(isFill(c) && c.x).toBeCloseTo((1 / 400) * FILL_REF);
		expect(isFill(c) && c.y).toBeCloseTo((1 / 200) * FILL_REF);
		expect(isFill(c) && c.spans.length).toBe(0);
	});
	it('refits to a different canvas without distortion, centred', () => {
		const json = serializeDrawing([stroke, shape], size);
		const [a, b] = loadDrawing(json, { w: 200, h: 400 }) as [Stroke, Shape];
		// Scale 0.5; the 100px-tall drawing sits in the vertical middle (offset 150).
		expect(a.points[0]).toMatchObject({ x: 5, y: 160, w: 3.5 });
		expect(isShape(b) && b.width).toBe(3.5);
		expect(b.y0).toBe(155);
	});
	it('keeps the tolerance of a fill', () => {
		const [c] = loadDrawing(serializeDrawing([{ ...fill, tolerance: 20 }], size), size)!;
		expect(isFill(c) && c.tolerance).toBe(20);
	});
	it('loads an empty drawing', () => {
		expect(loadDrawing(serializeDrawing([], size), size)).toEqual([]);
	});
});

describe('validation', () => {
	const wire = (items: unknown, extra: object = {}) =>
		JSON.stringify({ v: 1, size, items, ...extra });
	it('rejects non-drawings', () => {
		for (const bad of [
			null,
			42,
			'',
			'nope',
			'[]',
			'{}',
			JSON.stringify({ v: 2, size, items: [] }),
			JSON.stringify({ v: 1, size: { w: 0, h: 5 }, items: [] }),
			JSON.stringify({ v: 1, size: { w: 5 }, items: [] }),
			JSON.stringify({ v: 1, size, items: {} }),
			wire([null]),
			wire([{ t: 'pen', c: '', p: [] }]),
			wire([{ t: 'laser', c: 'x', p: [] }]),
			wire([{ t: 'pen', c: 'x', p: [1, 2] }]),
			wire([{ t: 'pen', c: 'x', p: [1, 2, 'a'] }]),
			wire([{ s: 'blob', c: 'x', f: true, w: 1, b: [1, 2, 3, 4] }]),
			wire([{ s: 'star', c: 'x', f: 'yes', w: 1, b: [1, 2, 3, 4] }]),
			wire([{ s: 'star', c: 'x', f: true, w: 1, b: [1, 2, 3] }]),
			wire([{ k: 2, c: 'x', x: 1, y: 1, o: 1 }]),
			wire([{ k: 1, c: 'x', x: 1, y: 1 }])
		])
			expect(isSavedDrawing(bad), String(bad)).toBe(false);
		expect(loadDrawing('nope', size)).toBeNull();
		expect(savedSize('nope')).toBeNull();
	});
	it('enforces size limits', () => {
		expect(isSavedDrawing('x'.repeat(SAVED_MAX_CHARS + 1))).toBe(false);
		const dots = Array.from({ length: SAVED_MAX_ITEMS + 1 }, () => ({
			t: 'pen',
			c: 'x',
			p: [1, 1, 1]
		}));
		expect(isSavedDrawing(wire(dots))).toBe(false);
		const long = { t: 'pen', c: 'x', p: new Array((SAVED_MAX_POINTS + 1) * 3).fill(1) };
		expect(isSavedDrawing(wire([long]))).toBe(false);
	});
});
