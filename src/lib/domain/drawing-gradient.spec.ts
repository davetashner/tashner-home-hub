import { describe, expect, it } from 'vitest';
import { PALETTE } from './drawing-colors.js';
import {
	DEFAULT_GRADIENT_END,
	gradientEnd,
	gradientStops,
	isGradientEnd,
	spanRange
} from './drawing-gradient.js';
import { FILL_STYLES, FILL_STYLE_LABELS } from './drawing-pattern.js';

describe('gradient fill', () => {
	it('is a listed fill style with a label', () => {
		expect(FILL_STYLES).toContain('gradient');
		expect(FILL_STYLE_LABELS.gradient).toBe('Gradient');
	});
	it('defaults the second color to a palette color (white)', () => {
		expect(PALETTE).toContain(DEFAULT_GRADIENT_END);
		expect(DEFAULT_GRADIENT_END).toBe('oklch(100% 0 0)');
	});
	it('validates second colors against the palette', () => {
		for (const c of PALETTE) expect(isGradientEnd(c)).toBe(true);
		for (const bad of ['red', '', 5, null, undefined, {}, 'url(x)'])
			expect(isGradientEnd(bad)).toBe(false);
	});
	it('falls back to the default for a bad second color', () => {
		expect(gradientEnd(PALETTE[3])).toBe(PALETTE[3]);
		expect(gradientEnd('nope')).toBe(DEFAULT_GRADIENT_END);
		expect(gradientEnd(undefined)).toBe(DEFAULT_GRADIENT_END);
	});
	it('finds the top and bottom of the runs', () => {
		expect(spanRange(new Uint32Array([5, 0, 3, 9, 2, 4, 7, 1, 1]))).toEqual({ y0: 5, y1: 10 });
		expect(spanRange(new Uint32Array([4, 0, 0]))).toEqual({ y0: 4, y1: 5 });
	});
	it('has no range for no runs or a partial triple', () => {
		expect(spanRange(new Uint32Array(0))).toBeNull();
		expect(spanRange(new Uint32Array([1, 2]))).toBeNull();
		expect(gradientStops(new Uint32Array(0), 'a', PALETTE[0])).toBeNull();
	});
	it('runs from the current color at the top to the second color at the bottom', () => {
		const g = gradientStops(new Uint32Array([2, 0, 9, 6, 0, 9]), 'top', PALETTE[1])!;
		expect(g.y0).toBe(2);
		expect(g.y1).toBe(7);
		expect(g.stops).toEqual([
			[0, 'top'],
			[1, PALETTE[1]]
		]);
		expect(gradientStops(new Uint32Array([0, 0, 1]), 'top', 'bad')!.stops[1][1]).toBe(
			DEFAULT_GRADIENT_END
		);
	});
});
