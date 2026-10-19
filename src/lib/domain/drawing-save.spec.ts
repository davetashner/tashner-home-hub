import { describe, expect, it } from 'vitest';
import { makeFill } from './drawing-fill.js';
import {
	FILL_REF,
	SAVED_MAX_CHARS,
	SAVED_MAX_ITEMS,
	SAVED_MAX_POINTS,
	isSavedDrawing,
	loadDrawing,
	savedPage,
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

describe('coloring pages', () => {
	it('stores items in page space and refits them to any canvas', () => {
		// On a 2000x1400 canvas the page scale is 2: a point at (400, 300) is (200, 150) on the page.
		const json = serializeDrawing(
			[{ ...stroke, points: [{ x: 400, y: 300, w: 10 }] }],
			{ w: 2000, h: 1400 },
			1,
			'fish'
		);
		expect(savedPage(json)).toBe('fish');
		expect(savedSize(json)).toEqual({ w: 1000, h: 700 });
		const [a] = loadDrawing(json, { w: 500, h: 700 }) as [Stroke];
		// Same spot on the page, now at scale 0.5 with the page centred vertically (offset 175).
		expect(a.points[0]).toEqual({ x: 100, y: 250, w: 2.5 });
	});
	it('a plain drawing has no page; a bad page is refused', () => {
		expect(savedPage(serializeDrawing([], size))).toBeNull();
		expect(isSavedDrawing(JSON.stringify({ v: 1, size, items: [], page: 'mickey' }))).toBe(false);
		expect(savedPage('nope')).toBeNull();
	});
	it('page drawings round trip shapes and fills', () => {
		const json = serializeDrawing([shape, fill], size, 2, 'house');
		const [b, c] = loadDrawing(json, size) as [Shape, DrawItem];
		expect(b.x0).toBeCloseTo(10, 0);
		expect(b.width).toBeCloseTo(7, 0);
		expect(isFill(c) && c.x).toBeCloseTo((1 / 400) * FILL_REF, -1);
	});
});

describe('rotated shapes', () => {
	it('keeps the turn through a save and reopen', () => {
		const json = serializeDrawing([{ ...shape, rot: 0.7854 }], size);
		const back = loadDrawing(json, size)![0] as Shape;
		expect(back.rot).toBeCloseTo(0.785, 3);
	});
	it('writes nothing extra for an upright shape, and old saves open upright', () => {
		const json = serializeDrawing([shape], size);
		expect(json).not.toContain('"r"');
		expect((loadDrawing(json, size)![0] as Shape).rot).toBeUndefined();
	});
	it('rejects a turn that is not a number', () => {
		const bad = JSON.stringify({
			v: 1,
			size,
			items: [{ s: 'star', c: 'x', f: true, w: 1, b: [1, 2, 3, 4], r: 'x' }]
		});
		expect(loadDrawing(bad, size)).toBeNull();
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
