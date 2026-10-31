import { describe, expect, it } from 'vitest';
import { makeFill } from './drawing-fill.js';
import {
	FILL_REF,
	SAVED_MAX_CHARS,
	SAVED_MAX_ITEMS,
	SAVED_MAX_POINTS,
	isSavedDrawing,
	isBackground,
	loadDrawing,
	loadFrames,
	savedBackground,
	savedPage,
	savedPhoto,
	savedSize,
	serializeDrawing
} from './drawing-save.js';
import { COLOR_GRID, isShape, type DrawItem, type Shape, type Stroke } from './drawing.js';
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

describe('background color', () => {
	const grid = COLOR_GRID[3];
	it('round-trips a grid color and defaults to paper', () => {
		expect(savedBackground(serializeDrawing([stroke], size, 1, null, grid))).toBe(grid);
		const plain = serializeDrawing([stroke], size);
		expect(plain).not.toContain('"bg"');
		expect(savedBackground(plain)).toBeNull();
		expect(savedBackground('nope')).toBeNull();
	});
	it('drops a color that is not on the grid when saving, and rejects one when loading', () => {
		expect(serializeDrawing([stroke], size, 1, null, 'red')).not.toContain('"bg"');
		const bad = JSON.stringify({ v: 1, size, bg: 'url(x)', items: [] });
		expect(isSavedDrawing(bad)).toBe(false);
		expect(isBackground(grid)).toBe(true);
		expect(isBackground(42)).toBe(false);
	});
});

describe('photo layer', () => {
	it('round-trips a photo id and writes nothing without one', () => {
		const json = serializeDrawing([stroke], size, 1, null, null, 'abc-123');
		expect(savedPhoto(json)).toBe('abc-123');
		expect(savedPhoto(serializeDrawing([stroke], size))).toBeNull();
		expect(savedPhoto('nope')).toBeNull();
	});
	it('drops a bad id and a photo on a coloring page when saving', () => {
		expect(serializeDrawing([stroke], size, 1, null, null, 'a/b')).not.toContain('photo');
		expect(serializeDrawing([stroke], size, 1, 'house', null, 'abc')).not.toContain('photo');
	});
	it('rejects a bad id, or a photo together with a page, when loading', () => {
		expect(isSavedDrawing(JSON.stringify({ v: 1, size, photo: '../x', items: [] }))).toBe(false);
		expect(
			isSavedDrawing(JSON.stringify({ v: 1, size, photo: 'a', page: 'house', items: [] }))
		).toBe(false);
	});

	it('round-trips the new stamps', () => {
		for (const k of ['house', 'tree', 'rocket', 'car', 'butterfly'] as const) {
			const item: Shape = { ...shape, shape: k };
			const [back] = loadDrawing(serializeDrawing([item], size), size)!;
			expect(isShape(back) && back.shape).toBe(k);
		}
	});
});

describe('mirrored strokes (hub-cn7.18)', () => {
	const mirrored: Stroke = { ...stroke, mirror: { n: 8, cx: 100, cy: 50 } };

	it('round-trips the mirror setting and keeps the center when refitted', () => {
		const json = serializeDrawing([mirrored], { w: 200, h: 100 });
		const same = loadDrawing(json, { w: 200, h: 100 }) as Stroke[];
		expect(same[0].mirror).toEqual({ n: 8, cx: 100, cy: 50 });
		const bigger = loadDrawing(json, { w: 400, h: 200 }) as Stroke[];
		expect(bigger[0].mirror).toEqual({ n: 8, cx: 200, cy: 100 });
		const portrait = loadDrawing(json, { w: 100, h: 300 }) as Stroke[];
		expect(portrait[0].mirror).toEqual({ n: 8, cx: 50, cy: 150 });
	});

	it('plain strokes stay plain and a malformed mirror is refused', () => {
		const plain = loadDrawing(serializeDrawing([stroke], { w: 200, h: 100 }), {
			w: 200,
			h: 100
		}) as Stroke[];
		expect(plain[0].mirror).toBeUndefined();
		const wire = JSON.parse(serializeDrawing([mirrored], { w: 200, h: 100 }));
		wire.items[0].m = [3, 1, 1];
		expect(isSavedDrawing(JSON.stringify(wire))).toBe(false);
	});
});

describe('line styles', () => {
	it('keeps dashed and dotted through a save and reopen', () => {
		for (const dash of ['dashed', 'dotted'] as const) {
			const back = loadDrawing(serializeDrawing([{ ...shape, dash }], size), size)![0] as Shape;
			expect(back.dash).toBe(dash);
		}
	});
	it('writes nothing for solid, and old saves open solid', () => {
		const json = serializeDrawing([shape], size);
		expect(json).not.toContain('"d"');
		expect((loadDrawing(json, size)![0] as Shape).dash).toBeUndefined();
	});
	it('rejects an unknown style', () => {
		const bad = JSON.stringify({
			v: 1,
			size,
			items: [{ s: 'star', c: 'x', f: true, w: 1, b: [1, 2, 3, 4], d: 'wavy' }]
		});
		expect(loadDrawing(bad, size)).toBeNull();
	});
});

describe('text items (hub-cn7.23)', () => {
	const text = {
		text: 'Hi\nYou',
		color: 'draw-blue',
		size: 80,
		x0: 40,
		y0: 60,
		x1: 400,
		y1: 252,
		rot: 0.4
	};
	it('round-trips text, size, box and turn', () => {
		const json = serializeDrawing([text], { w: 1000, h: 600 });
		expect(isSavedDrawing(json)).toBe(true);
		expect(loadDrawing(json, { w: 1000, h: 600 })).toEqual([text]);
	});
	it('rejects malformed text', () => {
		const bad = (it: object) =>
			isSavedDrawing(JSON.stringify({ v: 1, size: { w: 10, h: 10 }, items: [it] }));
		const ok = { tx: 'x', c: 'draw-red', z: 10, b: [0, 0, 1, 1] };
		expect(bad(ok)).toBe(true);
		for (const wrong of [{ tx: '' }, { z: 0 }, { b: [0] }, { tx: 'x'.repeat(500) }])
			expect(bad({ ...ok, ...wrong })).toBe(false);
	});
});

describe('flipbook frames (hub-cn7.26)', () => {
	const json = serializeDrawing([stroke], size, 1, null, null, null, [[shape], []]);
	it('round trips every frame and keeps frame 0 as the top-level items', () => {
		expect(isSavedDrawing(json)).toBe(true);
		const frames = loadFrames(json, size)!;
		expect(frames.map((f) => f.length)).toEqual([1, 1, 0]);
		expect(isShape(frames[1][0])).toBe(true);
		expect(loadDrawing(json, size)).toHaveLength(1);
		expect(JSON.parse(json).items).toHaveLength(1);
	});
	it('opens a plain drawing as one frame', () => {
		expect(loadFrames(serializeDrawing([stroke], size), size)).toHaveLength(1);
	});
	it('counts items across all frames and rejects bad or too many frames', () => {
		const many = Array.from({ length: SAVED_MAX_ITEMS }, () => shape);
		expect(isSavedDrawing(serializeDrawing(many, size, 1, null, null, null, [[shape]]))).toBe(
			false
		);
		const w = JSON.parse(json);
		expect(isSavedDrawing(JSON.stringify({ ...w, frames: 'x' }))).toBe(false);
		expect(isSavedDrawing(JSON.stringify({ ...w, frames: Array(30).fill([]) }))).toBe(false);
		expect(isSavedDrawing(JSON.stringify({ ...w, frames: [[{ c: 'draw-red' }]] }))).toBe(false);
	});
});
