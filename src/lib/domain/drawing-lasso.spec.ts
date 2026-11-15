import { describe, expect, it } from 'vitest';
import type { DrawItem, Shape, Stroke } from './drawing.js';
import type { FillItem } from './drawing-fill.js';
import {
	BOX_PAD,
	COPY_OFFSET,
	MAX_SCALE,
	MIN_SIDE,
	copyOffset,
	copyStrokes,
	frameOf,
	inBox,
	inkBounds,
	isLassoInk,
	isLoop,
	lassoSelection,
	moveBy,
	pointInPolygon,
	polygonArea,
	resizeHandle,
	resizeTo,
	selectInside,
	transformStroke
} from './drawing-lasso.js';

const stroke = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
	tool: 'pen',
	color: 'draw-black',
	points: pts.map(([x, y]) => ({ x, y, w: 10 })),
	...extra
});
const square = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 100 },
	{ x: 0, y: 100 }
];

describe('polygon helpers', () => {
	it('pointInPolygon tells inside from outside, including concave loops', () => {
		expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
		expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
		const u = [
			{ x: 0, y: 0 },
			{ x: 30, y: 0 },
			{ x: 30, y: 60 },
			{ x: 70, y: 60 },
			{ x: 70, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
			{ x: 0, y: 100 }
		];
		expect(pointInPolygon({ x: 50, y: 30 }, u)).toBe(false);
		expect(pointInPolygon({ x: 50, y: 80 }, u)).toBe(true);
		expect(pointInPolygon({ x: 1, y: 1 }, [])).toBe(false);
	});
	it('polygonArea and isLoop reject taps and straight scribbles', () => {
		expect(polygonArea(square)).toBe(10000);
		expect(isLoop(square)).toBe(true);
		expect(isLoop([])).toBe(false);
		expect(isLoop([{ x: 1, y: 1 }])).toBe(false);
		expect(isLoop([square[0], square[1], { x: 200, y: 0 }])).toBe(false);
	});
});

describe('selecting ink', () => {
	const inside = stroke([
		[20, 20],
		[50, 50],
		[80, 80]
	]);
	const outside = stroke([
		[200, 200],
		[250, 250]
	]);
	const straddle = stroke([
		[10, 10],
		[20, 20],
		[30, 30],
		[300, 300]
	]);
	const half = stroke([
		[50, 50],
		[500, 500]
	]);
	const eraser = stroke([[50, 50]], { tool: 'eraser' });
	const shape = {
		shape: 'square',
		color: 'draw-black',
		filled: false,
		width: 4,
		x0: 10,
		y0: 10,
		x1: 60,
		y1: 60
	} as Shape;
	const fill = { fill: true } as unknown as FillItem;
	const items: DrawItem[] = [inside, outside, straddle, half, eraser, shape, fill];

	it('picks strokes with most of their points inside, in order, with the eraser cuts over them', () => {
		// Index 4 is the eraser at (50, 50): inside the loop and drawn after the selected ink.
		expect(selectInside(items, square)).toEqual([0, 2, 4]);
		expect(lassoSelection(items, square)).toEqual([inside, straddle, eraser]);
	});
	it('takes eraser strokes only when mostly inside the loop and over selected ink', () => {
		const cutIn = stroke(
			[
				[40, 40],
				[60, 60]
			],
			{ tool: 'eraser' }
		);
		const cutOut = stroke(
			[
				[400, 400],
				[450, 450]
			],
			{ tool: 'eraser' }
		);
		const cutMostlyOut = stroke(
			[
				[40, 40],
				[400, 400],
				[450, 450]
			],
			{ tool: 'eraser' }
		);
		const cutBefore = stroke([[40, 40]], { tool: 'eraser' });
		const board: DrawItem[] = [cutBefore, inside, cutIn, cutOut, cutMostlyOut, shape];
		// The cut drawn before the ink cannot have cut it; the far cuts stay put.
		expect(selectInside(board, square)).toEqual([1, 2]);
	});
	it('never selects eraser strokes alone', () => {
		expect(selectInside([eraser, outside], square)).toEqual([]);
		expect(selectInside([outside, eraser], square)).toEqual([]);
		expect(selectInside([stroke([], { tool: 'eraser' }), inside], square)).toEqual([1]);
	});
	it('ignores shapes and fills, and lone eraser cuts', () => {
		expect(isLassoInk(eraser)).toBe(false);
		expect(isLassoInk(shape)).toBe(false);
		expect(isLassoInk(fill)).toBe(false);
		expect(isLassoInk(inside)).toBe(true);
	});
	it('selects nothing for a malformed loop, empty board or pointless stroke', () => {
		expect(selectInside(items, [])).toEqual([]);
		expect(selectInside(items, square.slice(0, 2))).toEqual([]);
		expect(selectInside([], square)).toEqual([]);
		expect(selectInside([stroke([])], square)).toEqual([]);
		expect(isLassoInk({ points: 'x', tool: 'pen' } as unknown as DrawItem)).toBe(false);
	});
});

describe('bounds and frame', () => {
	it('inkBounds covers points plus half the line width; null when empty', () => {
		const b = inkBounds([
			stroke([
				[10, 20],
				[50, 80]
			])
		]);
		expect(b).toEqual({ x: 5, y: 15, w: 50, h: 70 });
		expect(inkBounds([])).toBeNull();
		expect(inkBounds([stroke([])])).toBeNull();
	});
	it('frameOf pads, inBox hits with slop, the handle is the bottom-right corner', () => {
		const f = frameOf({ x: 10, y: 10, w: 20, h: 20 });
		expect(f).toEqual({
			x: 10 - BOX_PAD,
			y: 10 - BOX_PAD,
			w: 20 + 2 * BOX_PAD,
			h: 20 + 2 * BOX_PAD
		});
		expect(inBox({ x: 20, y: 20 }, f)).toBe(true);
		expect(inBox({ x: 100, y: 20 }, f)).toBe(false);
		expect(resizeHandle(f)).toEqual({ x: f.x + f.w, y: f.y + f.h });
	});
});

describe('transforms', () => {
	const s = stroke(
		[
			[10, 10],
			[30, 20]
		],
		{ mirror: { n: 2, cx: 100, cy: 50 }, seed: 7 }
	);
	it('move shifts points and the mirror centre, keeps width and the rest, never mutates', () => {
		const m = transformStroke(s, moveBy(5, -5));
		expect(m.points[0]).toEqual({ x: 15, y: 5, w: 10 });
		expect(m.mirror).toEqual({ n: 2, cx: 105, cy: 45 });
		expect(m.seed).toBe(7);
		expect(s.points[0]).toEqual({ x: 10, y: 10, w: 10 });
		expect(s.mirror?.cx).toBe(100);
	});
	it('a stroke without a mirror stays without one', () => {
		expect(transformStroke(stroke([[1, 1]]), moveBy(1, 1)).mirror).toBeUndefined();
	});
	it('resizeTo keeps the top-left fixed and scales widths with the ink', () => {
		const frame = { x: 0, y: 0, w: 100, h: 100 };
		const t = resizeTo(frame, { x: 200, y: 200 }, 0);
		expect(t.scale).toBeCloseTo(2);
		const out = transformStroke(stroke([[50, 50]]), t);
		expect(out.points[0]).toEqual({ x: 100, y: 100, w: 20 });
	});
	it('resizeTo with the frame padding leaves the handle under the finger at scale 1', () => {
		const ink = { x: 20, y: 20, w: 100, h: 100 };
		const f = frameOf(ink);
		const t = resizeTo(f, resizeHandle(f));
		expect(t.scale).toBeCloseTo(1);
		expect(t.anchor).toEqual({ x: 20, y: 20 });
	});
	it('resizeTo clamps tiny and huge drags, and survives a zero frame', () => {
		const frame = { x: 0, y: 0, w: 200, h: 100 };
		expect(resizeTo(frame, { x: -500, y: -500 }, 0).scale).toBeCloseTo(MIN_SIDE / 100);
		expect(resizeTo(frame, { x: 1e6, y: 1e6 }, 0).scale).toBe(MAX_SCALE);
		expect(resizeTo({ x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5 }, 0).scale).toBeGreaterThan(0);
		expect(resizeTo(frame, { x: NaN, y: 0 }, 0).scale).toBe(1);
		expect(resizeTo({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0 }, 0).scale).toBe(1);
	});
	it('copyStrokes duplicates shifted by the offset and leaves the originals', () => {
		const [c] = copyStrokes([s]);
		expect(c).not.toBe(s);
		expect(c.points[0].x).toBe(10 + COPY_OFFSET.x);
		expect(c.points[0].y).toBe(10 + COPY_OFFSET.y);
		expect(copyStrokes([s], { x: -1, y: 0 })[0].points[0].x).toBe(9);
	});
	it('copyOffset flips back when the copy would leave the board', () => {
		const board = { w: 500, h: 500 };
		expect(copyOffset({ x: 10, y: 10, w: 50, h: 50 }, board)).toEqual(COPY_OFFSET);
		expect(copyOffset({ x: 400, y: 10, w: 90, h: 50 }, board).x).toBe(-COPY_OFFSET.x);
		expect(copyOffset({ x: 10, y: 400, w: 50, h: 90 }, board).y).toBe(-COPY_OFFSET.y);
	});
});
