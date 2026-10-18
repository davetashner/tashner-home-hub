import { describe, expect, it } from 'vitest';
import {
	ALL_SHAPES,
	BRUSH_SCALE,
	FIXED_WIDTH,
	SHAPE_DEFAULT_SIZE,
	hitShape,
	isBlank,
	isLineShape,
	isShape,
	placement,
	shapeBounds,
	shapeParts,
	shapeWidth,
	undoStroke,
	type DrawItem,
	type Shape
} from './drawing.js';

const shape = (over: Partial<Shape> = {}): Shape => ({
	shape: 'circle',
	color: 'draw-red',
	filled: false,
	width: 7,
	x0: 10,
	y0: 20,
	x1: 110,
	y1: 80,
	...over
});

describe('placement', () => {
	it('uses a real drag as is', () => {
		expect(placement('star', { x: 5, y: 5 }, { x: 105, y: 65 })).toEqual({
			x0: 5,
			y0: 5,
			x1: 105,
			y1: 65
		});
	});
	it('a tap places a default-size shape centered on it', () => {
		const p = placement('heart', { x: 200, y: 100 }, { x: 201, y: 100 });
		expect(p.x1 - p.x0).toBe(SHAPE_DEFAULT_SIZE);
		expect(p.y1 - p.y0).toBe(SHAPE_DEFAULT_SIZE);
		expect((p.x0 + p.x1) / 2).toBe(200);
		expect((p.y0 + p.y1) / 2).toBe(100);
	});
	it('a tapped line is horizontal', () => {
		const p = placement('arrow', { x: 50, y: 50 }, { x: 50, y: 50 });
		expect(p.y0).toBe(p.y1);
		expect(p.x1 - p.x0).toBe(SHAPE_DEFAULT_SIZE);
	});
	it('knows which shapes are lines', () => {
		expect(isLineShape('line')).toBe(true);
		expect(isLineShape('arrow')).toBe(true);
		expect(isLineShape('star')).toBe(false);
	});
});

describe('bounds and hits', () => {
	it('normalizes a drag up and to the left', () => {
		expect(shapeBounds({ x0: 100, y0: 80, x1: 10, y1: 20 })).toEqual({
			x: 10,
			y: 20,
			w: 90,
			h: 60
		});
	});
	it('hits inside the box and near its edge, misses far away', () => {
		const s = shape();
		expect(hitShape(s, 50, 50)).toBe(true);
		expect(hitShape(s, 112, 50)).toBe(true);
		expect(hitShape(s, 300, 50)).toBe(false);
		expect(hitShape(s, 50, 50, 0)).toBe(true);
		expect(hitShape(s, 112, 50, 0)).toBe(false);
	});
	it('outline width follows the brush size', () => {
		expect(shapeWidth('thick')).toBe(FIXED_WIDTH * BRUSH_SCALE.thick);
	});
});

describe('shape geometry', () => {
	it('every shape and stamp has parts with commands, all finite', () => {
		for (const k of ALL_SHAPES) {
			const parts = shapeParts(shape({ shape: k }));
			expect(parts.length).toBeGreaterThan(0);
			for (const p of parts) {
				expect(p.cmds.length).toBeGreaterThan(0);
				for (const c of p.cmds) for (const n of c.slice(1)) expect(Number.isFinite(n)).toBe(true);
			}
		}
	});
	it('closed shapes stay inside their box', () => {
		for (const k of ['square', 'triangle', 'star', 'heart'] as const) {
			const b = shapeBounds(shape({ shape: k }));
			for (const part of shapeParts(shape({ shape: k })))
				for (const c of part.cmds) {
					if (c[0] === 'Z') continue;
					const xs = c.filter((_, i) => i > 0 && i % 2 === 1) as number[];
					const ys = c.filter((_, i) => i > 0 && i % 2 === 0) as number[];
					for (const x of xs) expect(x).toBeGreaterThanOrEqual(b.x - 0.001);
					for (const x of xs) expect(x).toBeLessThanOrEqual(b.x + b.w + 0.001);
					for (const y of ys) expect(y).toBeGreaterThanOrEqual(b.y - 0.001);
					for (const y of ys) expect(y).toBeLessThanOrEqual(b.y + b.h + 0.001);
				}
		}
	});
	it('a star has ten points, a square four corners', () => {
		expect(shapeParts(shape({ shape: 'star' }))[0].cmds).toHaveLength(11);
		expect(shapeParts(shape({ shape: 'square' }))[0].cmds).toHaveLength(5);
	});
	it('a line runs between its two ends; an arrow adds a head at the end', () => {
		expect(shapeParts(shape({ shape: 'line' }))[0].cmds).toEqual([
			['M', 10, 20],
			['L', 110, 80]
		]);
		const arrow = shapeParts(shape({ shape: 'arrow' }));
		expect(arrow).toHaveLength(2);
		expect(arrow[1].cmds[0]).toEqual(['M', 110, 80]);
	});
	it('stamps combine outline, solid and line parts', () => {
		const kinds = (k: Shape['shape']) => shapeParts(shape({ shape: k })).map((p) => p.kind);
		expect(kinds('smiley')).toEqual(['body', 'solid', 'solid', 'line']);
		expect(kinds('sun')).toEqual(['body', 'line']);
		expect(kinds('flower')).toContain('solid');
	});
});

describe('shapes on the board', () => {
	it('a placed shape counts as ink and undo removes it', () => {
		const items: DrawItem[] = [shape()];
		expect(isShape(items[0])).toBe(true);
		expect(isBlank(items)).toBe(false);
		expect(undoStroke(items)).toEqual([]);
	});
	it('a stroke is not a shape', () => {
		expect(isShape({ tool: 'pen', color: 'draw-red', points: [] })).toBe(false);
	});
});
