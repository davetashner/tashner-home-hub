import { describe, expect, it } from 'vitest';
import {
	BROWN_COLORS,
	EXTRA_COLORS,
	NEUTRAL_COLORS,
	OPACITY_STEPS,
	PALETTE,
	SKIN_COLORS,
	clampAlpha,
	isTranslucent
} from './drawing-colors.js';
import { COLOR_GRID, type Shape, type Stroke } from './drawing.js';
import { restyleShape } from './drawing-edit.js';
import { isBackground, loadDrawing, serializeDrawing } from './drawing-save.js';

const size = { w: 400, h: 300 };
const shape: Shape = {
	shape: 'circle',
	color: 'draw-red',
	filled: false,
	width: 7,
	x0: 10,
	y0: 10,
	x1: 90,
	y1: 90
};

describe('extra colors', () => {
	it('adds white, greys, browns and skin tones as unique oklch colors', () => {
		expect(NEUTRAL_COLORS[0]).toBe('oklch(100% 0 0)');
		expect(NEUTRAL_COLORS.length).toBeGreaterThanOrEqual(6);
		expect(BROWN_COLORS.length).toBeGreaterThanOrEqual(6);
		expect(SKIN_COLORS.length).toBeGreaterThanOrEqual(6);
		expect(EXTRA_COLORS.every((c) => c.startsWith('oklch('))).toBe(true);
		expect(PALETTE).toHaveLength(COLOR_GRID.length + EXTRA_COLORS.length);
		expect(new Set(PALETTE).size).toBe(PALETTE.length);
	});
	it('accepts every palette color as a saved background', () => {
		expect(PALETTE.every(isBackground)).toBe(true);
		expect(isBackground('oklch(1% 0 0)')).toBe(false);
	});
});

describe('opacity', () => {
	it('offers at least four steps from 25 to 100 percent', () => {
		expect(OPACITY_STEPS.length).toBeGreaterThanOrEqual(4);
		expect(Math.min(...OPACITY_STEPS)).toBe(0.25);
		expect(Math.max(...OPACITY_STEPS)).toBe(1);
	});
	it('clamps junk to a usable value', () => {
		expect(clampAlpha(0.5)).toBe(0.5);
		expect(clampAlpha(0)).toBe(0.1);
		expect(clampAlpha(7)).toBe(1);
		expect(clampAlpha('x')).toBe(1);
		expect(clampAlpha(NaN)).toBe(1);
		expect(isTranslucent(undefined)).toBe(false);
		expect(isTranslucent(1)).toBe(false);
		expect(isTranslucent(0.5)).toBe(true);
	});
	it('restyles a selected shape and drops alpha at 100 percent', () => {
		const faded = restyleShape(shape, { alpha: 0.5 });
		expect(faded.alpha).toBe(0.5);
		expect(restyleShape(faded, { alpha: 0.5 })).toBe(faded);
		expect('alpha' in restyleShape(faded, { alpha: 1 })).toBe(false);
		expect(restyleShape(shape, { alpha: 1 })).toBe(shape);
	});
	it('round-trips pen and shape opacity and the new colors', () => {
		const pen: Stroke = {
			tool: 'pen',
			color: SKIN_COLORS[2],
			alpha: 0.25,
			points: [{ x: 1, y: 2, w: 3 }]
		};
		const hl: Stroke = { tool: 'highlighter', color: 'draw-red', alpha: 0.5, points: [] };
		const out = loadDrawing(
			serializeDrawing(
				[pen, { ...shape, alpha: 0.75, color: BROWN_COLORS[1] }, hl],
				size,
				1,
				null,
				NEUTRAL_COLORS[3]
			),
			size
		)!;
		expect((out[0] as Stroke).alpha).toBe(0.25);
		expect((out[0] as Stroke).color).toBe(SKIN_COLORS[2]);
		expect((out[1] as Shape).alpha).toBe(0.75);
		expect((out[2] as Stroke).alpha).toBeUndefined();
	});
	it('opens saves with no opacity as opaque and rejects a bad one', () => {
		const old = JSON.stringify({
			v: 1,
			size,
			items: [{ t: 'pen', c: 'draw-red', p: [1, 2, 3] }]
		});
		expect((loadDrawing(old, size)![0] as Stroke).alpha).toBeUndefined();
		const bad = JSON.stringify({
			v: 1,
			size,
			items: [{ t: 'pen', c: 'draw-red', p: [1, 2, 3], a: 'x' }]
		});
		expect(loadDrawing(bad, size)).toBeNull();
		const badShape = JSON.stringify({
			v: 1,
			size,
			items: [{ s: 'circle', c: 'draw-red', f: false, w: 1, b: [0, 0, 1, 1], a: 'x' }]
		});
		expect(loadDrawing(badShape, size)).toBeNull();
	});
});
