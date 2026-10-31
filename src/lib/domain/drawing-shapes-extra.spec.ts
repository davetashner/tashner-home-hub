import { describe, expect, it } from 'vitest';
import { ALL_SHAPES, SHAPE_LABELS, placement, shapeParts, type Shape } from './drawing.js';
import { EXTRA_SHAPE_KINDS, extraShapeParts, isExtraShape } from './drawing-shapes-extra.js';
import { loadDrawing, serializeDrawing } from './drawing-save.js';

const box = { x: 10, y: 20, w: 200, h: 100 };

describe('extra shapes', () => {
	it('are in the picker with labels', () => {
		expect(EXTRA_SHAPE_KINDS).toHaveLength(10);
		for (const k of EXTRA_SHAPE_KINDS) {
			expect(ALL_SHAPES).toContain(k);
			expect(SHAPE_LABELS[k]).toBeTruthy();
			expect(isExtraShape(k)).toBe(true);
		}
		expect(isExtraShape('circle')).toBe(false);
	});
	it('each has a closed body that stays inside its box', () => {
		for (const k of EXTRA_SHAPE_KINDS) {
			const parts = extraShapeParts(k, box);
			expect(parts.some((p) => p.kind === 'body')).toBe(true);
			for (const part of parts)
				for (const c of part.cmds) {
					if (c[0] === 'Z') continue;
					if (c[0] === 'E') {
						expect(c[1] - c[3]).toBeGreaterThanOrEqual(box.x - 0.001);
						expect(c[1] + c[3]).toBeLessThanOrEqual(box.x + box.w + 0.001);
						continue;
					}
					for (let i = 1; i < c.length; i += 2) {
						expect(c[i]).toBeGreaterThanOrEqual(box.x - 0.001);
						expect(c[i]).toBeLessThanOrEqual(box.x + box.w + 0.001);
						expect(c[i + 1]).toBeGreaterThanOrEqual(box.y - 0.001);
						expect(c[i + 1]).toBeLessThanOrEqual(box.y + box.h + 0.001);
					}
				}
		}
	});
	it('are reached through shapeParts and scale with the box', () => {
		for (const k of EXTRA_SHAPE_KINDS) {
			const a = shapeParts({ shape: k, x0: 0, y0: 0, x1: 100, y1: 100 });
			const b = shapeParts({ shape: k, x0: 0, y0: 0, x1: 200, y1: 150 });
			expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
		}
	});
	it('counts points on polygons', () => {
		const n = (k: (typeof EXTRA_SHAPE_KINDS)[number]) =>
			extraShapeParts(k, box)[0].cmds.filter((c) => c[0] === 'M' || c[0] === 'L').length;
		expect(n('diamond')).toBe(4);
		expect(n('pentagon')).toBe(5);
		expect(n('hexagon')).toBe(6);
		expect(n('doublearrow')).toBe(10);
		expect(n('bolt')).toBe(7);
	});
	it('a rainbow has an inner stripe line', () => {
		expect(extraShapeParts('rainbow', box).some((p) => p.kind === 'line')).toBe(true);
	});
	it('an oval tap is wider than tall, other shapes square', () => {
		const o = placement('oval', { x: 100, y: 100 }, { x: 100, y: 100 });
		expect(o.x1 - o.x0).toBeGreaterThan(o.y1 - o.y0);
		const d = placement('diamond', { x: 100, y: 100 }, { x: 100, y: 100 });
		expect(d.x1 - d.x0).toBe(d.y1 - d.y0);
	});
	it('round-trip through a saved drawing', () => {
		const size = { w: 400, h: 300 };
		const items: Shape[] = EXTRA_SHAPE_KINDS.map((k, i) => ({
			shape: k,
			color: 'draw-red',
			filled: i % 2 === 0,
			width: 7,
			x0: 10,
			y0: 10,
			x1: 110,
			y1: 90
		}));
		const back = loadDrawing(serializeDrawing(items, size), size) as Shape[];
		expect(back.map((s) => s.shape)).toEqual(EXTRA_SHAPE_KINDS);
	});
});
