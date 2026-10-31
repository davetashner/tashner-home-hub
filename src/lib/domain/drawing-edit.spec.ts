import { describe, expect, it } from 'vitest';
import {
	GRAB_SLOP,
	ROTATE_GAP,
	SHAPE_MIN_SIZE,
	clampPoint,
	handlePoints,
	hitBody,
	moveShape,
	normAngle,
	resizeShape,
	restyleShape,
	rotatePoint,
	rotateShape,
	rotationOf,
	selectionCorners,
	shapeCenter
} from './drawing-edit.js';
import type { Shape } from './drawing.js';

const box = (over: Partial<Shape> = {}): Shape => ({
	shape: 'square',
	color: 'draw-red',
	filled: false,
	width: 7,
	x0: 100,
	y0: 100,
	x1: 200,
	y1: 160,
	...over
});
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('basic geometry', () => {
	it('rotates a point about another', () => {
		const p = rotatePoint({ x: 2, y: 0 }, { x: 1, y: 0 }, Math.PI / 2);
		expect([Math.round(p.x), Math.round(p.y)]).toEqual([1, 1]);
	});
	it('wraps angles', () => {
		near(normAngle(3 * Math.PI), Math.PI);
		near(normAngle(-3 * Math.PI), Math.PI);
		near(normAngle(Math.PI * 1.5), -Math.PI / 2);
	});
	it('finds the centre and defaults rotation to zero', () => {
		expect(shapeCenter(box())).toEqual({ x: 150, y: 130 });
		expect([rotationOf(box()), rotationOf(box({ rot: 1 }))]).toEqual([0, 1]);
	});
	it('clamps handles onto the board, even a tiny one', () => {
		expect(clampPoint({ x: -50, y: 900 }, 400, 300)).toEqual({ x: 48, y: 252 });
		expect(clampPoint({ x: 10, y: 10 }, 60, 60)).toEqual({ x: 30, y: 30 });
	});
});

describe('hitBody', () => {
	it('hits inside and within the finger slack, not beyond', () => {
		const s = box();
		expect(hitBody(s, { x: 150, y: 130 })).toBe(true);
		expect(hitBody(s, { x: 100 - GRAB_SLOP, y: 130 })).toBe(true);
		expect(hitBody(s, { x: 100 - GRAB_SLOP - 20, y: 130 })).toBe(false);
	});
	it('follows the turn', () => {
		// A wide box turned a quarter lies tall: a point above it now hits, one beside it does not.
		const s = box({ x0: 0, y0: 0, x1: 200, y1: 20, rot: Math.PI / 2 });
		expect(hitBody(s, { x: 100, y: 90 })).toBe(true);
		expect(hitBody(s, { x: 190, y: 10 })).toBe(false);
	});
});

describe('handles', () => {
	it('puts resize at the bottom right and rotate above the middle', () => {
		const h = handlePoints(box());
		expect(h.resize).toEqual({ x: 200, y: 160 });
		near(h.rotate.x, 150);
		near(h.rotate.y, 100 - ROTATE_GAP);
	});
	it('turns the handles with the shape', () => {
		const h = handlePoints(box({ rot: Math.PI }));
		near(h.resize.x, 100);
		near(h.resize.y, 100);
	});
	it('puts a line handle at its end and the rotate handle beside it', () => {
		const h = handlePoints(box({ shape: 'line', x0: 0, y0: 50, x1: 100, y1: 50 }));
		expect(h.resize).toEqual({ x: 100, y: 50 });
		near(h.rotate.x, 50);
		near(h.rotate.y, 50 + ROTATE_GAP);
	});
	it('copes with a zero-length line', () => {
		const h = handlePoints(box({ shape: 'arrow', x0: 5, y0: 5, x1: 5, y1: 5 }));
		expect(h.rotate.y).toBe(5 - ROTATE_GAP);
	});
	it('frames the shape with padding, turned with it', () => {
		const c = selectionCorners(box());
		expect(c).toHaveLength(4);
		near(c[0].x, 100 - 9.5);
		const t = selectionCorners(box({ rot: Math.PI }));
		near(t[0].x, 200 + 9.5);
	});
});

describe('moveShape', () => {
	it('shifts both corners', () => {
		const m = moveShape(box({ rot: 0.3 }), 10, -5);
		expect(m).toMatchObject({ x0: 110, y0: 95, x1: 210, y1: 155, rot: 0.3 });
	});
});

describe('resizeShape', () => {
	it('keeps the top-left fixed for an upright box', () => {
		const r = resizeShape(box(), { x: 300, y: 200 });
		expect(r).toMatchObject({ x0: 100, y0: 100, x1: 300, y1: 200 });
	});
	it('never squeezes below the minimum', () => {
		const r = resizeShape(box(), { x: 0, y: 0 });
		near(r.x1 - r.x0, SHAPE_MIN_SIZE);
		near(r.y1 - r.y0, SHAPE_MIN_SIZE);
	});
	it('keeps the opposite corner on the board when turned', () => {
		const s = box({ rot: Math.PI / 2 });
		const b = { x: 100, y: 100 };
		const anchor = rotatePoint(b, shapeCenter(s), Math.PI / 2);
		const handle = handlePoints(s).resize;
		const r = resizeShape(s, { x: handle.x + 0, y: handle.y + 30 });
		const after = rotatePoint(
			{ x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1) },
			shapeCenter(r),
			Math.PI / 2
		);
		near(after.x, anchor.x);
		near(after.y, anchor.y);
		expect(r.rot).toBe(Math.PI / 2);
	});
	it('drags a line end and keeps a minimum length', () => {
		const line = box({ shape: 'line', x0: 0, y0: 0, x1: 100, y1: 0 });
		expect(resizeShape(line, { x: 40, y: 30 })).toMatchObject({ x0: 0, y0: 0, x1: 40, y1: 30 });
		const tiny = resizeShape(line, { x: 3, y: 4 });
		near(Math.hypot(tiny.x1 - tiny.x0, tiny.y1 - tiny.y0), SHAPE_MIN_SIZE);
		const none = resizeShape(line, { x: 0, y: 0 });
		expect(none.x1).toBe(SHAPE_MIN_SIZE);
	});
});

describe('rotateShape', () => {
	it('adds the swept angle to a box', () => {
		const s = box();
		const c = shapeCenter(s);
		const r = rotateShape(s, { x: c.x + 50, y: c.y }, { x: c.x, y: c.y + 50 });
		near(r.rot ?? 0, Math.PI / 2);
		const again = rotateShape(r, { x: c.x + 50, y: c.y }, { x: c.x, y: c.y + 50 });
		near(again.rot ?? 0, Math.PI);
	});
	it('turns a line by moving its ends', () => {
		const line = box({ shape: 'arrow', x0: 0, y0: 0, x1: 100, y1: 0 });
		const r = rotateShape(line, { x: 100, y: 0 }, { x: 50, y: 50 });
		expect(r.rot).toBeUndefined();
		near(r.x0, 50);
		near(r.y0, -50);
		near(r.x1, 50);
		near(r.y1, 50);
	});
});

describe('restyleShape', () => {
	it('changes only the fields given and keeps box and turn', () => {
		const s = box({ rot: 0.5 });
		const next = restyleShape(s, { color: 'draw-blue', filled: true, width: 14 });
		expect(next).toEqual({ ...s, color: 'draw-blue', filled: true, width: 14 });
		expect(restyleShape(s, { width: 14 })).toEqual({ ...s, width: 14 });
		expect(s.color).toBe('draw-red');
	});

	it('returns the same object when nothing changes', () => {
		const s = box();
		expect(restyleShape(s, {})).toBe(s);
		expect(restyleShape(s, { color: 'draw-red', filled: false, width: 7 })).toBe(s);
	});

	it('sets and clears the dash', () => {
		const s = box();
		const d = restyleShape(s, { dash: 'dashed' });
		expect(d.dash).toBe('dashed');
		expect(restyleShape(d, { dash: 'dashed' })).toBe(d);
		const back = restyleShape(d, { dash: null });
		expect('dash' in back).toBe(false);
		expect(restyleShape(s, { dash: null })).toBe(s);
	});
});
