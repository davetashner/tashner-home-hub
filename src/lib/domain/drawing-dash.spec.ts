import { describe, expect, it } from 'vitest';
import { dashPattern, isDashStyle, lineStyleOf, LINE_STYLES } from './drawing-dash.js';

describe('dashPattern', () => {
	it('is empty for solid', () => {
		expect(dashPattern(undefined, 8)).toEqual([]);
	});
	it('scales dashes with width', () => {
		const a = dashPattern('dashed', 4);
		const b = dashPattern('dashed', 8);
		expect(b[0]).toBe(a[0] * 2);
		expect(b[1]).toBe(a[1] * 2);
	});
	it('dots are points spaced by width', () => {
		const [on, off] = dashPattern('dotted', 6);
		expect(on).toBeLessThan(1);
		expect(off).toBe(12);
	});
	it('never collapses at tiny widths', () => {
		expect(dashPattern('dashed', 0).every((n) => n > 0)).toBe(true);
	});
});

describe('line style helpers', () => {
	it('reads solid when absent', () => {
		expect(lineStyleOf({})).toBe('solid');
		expect(lineStyleOf({ dash: 'dotted' })).toBe('dotted');
	});
	it('validates', () => {
		expect(isDashStyle('dashed')).toBe(true);
		expect(isDashStyle('solid')).toBe(false);
		expect(isDashStyle(3)).toBe(false);
		expect(LINE_STYLES).toHaveLength(3);
	});
});
