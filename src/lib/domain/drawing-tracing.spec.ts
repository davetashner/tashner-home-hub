import { describe, expect, it } from 'vitest';
import {
	DOT_GAP,
	TRACE_CHARS,
	dotsAlong,
	isTraceId,
	strokeCount,
	traceChar,
	traceId,
	tracingPaths
} from './drawing-tracing.js';
import { PAGE_SIZE, isPageId, pageDrawing, pageLabel, pagePaths } from './drawing-pages.js';

describe('trace ids', () => {
	it('round-trips every letter and number', () => {
		expect(TRACE_CHARS).toHaveLength(36);
		for (const ch of TRACE_CHARS) {
			expect(traceChar(traceId(ch))).toBe(ch);
			expect(isTraceId(traceId(ch))).toBe(true);
			expect(isPageId(traceId(ch))).toBe(true);
		}
	});
	it('rejects malformed ids', () => {
		for (const bad of ['trace-', 'trace-a', 'trace-AB', 'trace-!', 'A', 'house', '', 7, null, {}])
			expect(isTraceId(bad)).toBe(false);
		expect(traceChar(undefined)).toBeNull();
		expect(isPageId('trace-a')).toBe(false);
	});
});

describe('dotsAlong', () => {
	it('spaces dots evenly and keeps both ends', () => {
		const d = dotsAlong(
			[
				[0, 0],
				[100, 0]
			],
			25
		);
		expect(d.map((p) => p[0])).toEqual([0, 25, 50, 75, 100]);
	});
	it('carries the spacing round corners', () => {
		const d = dotsAlong(
			[
				[0, 0],
				[30, 0],
				[30, 30]
			],
			20
		);
		expect(d[1]).toEqual([20, 0]);
		expect(d[2][0]).toBeCloseTo(30);
		expect(d[2][1]).toBeCloseTo(10);
	});
	it('handles empty input, a bad gap and a single point', () => {
		expect(dotsAlong([], 10)).toEqual([]);
		expect(dotsAlong([[1, 1]], 0)).toEqual([]);
		expect(dotsAlong([[1, 1]], 10)).toEqual([[1, 1]]);
	});
	it('skips a last dot that would crowd the previous one', () => {
		const d = dotsAlong(
			[
				[0, 0],
				[102, 0]
			],
			50
		);
		expect(d.map((p) => p[0])).toEqual([0, 50, 100]);
	});
});

describe('tracing pages', () => {
	it('gives every glyph guides inside the page, with a start arrow per stroke', () => {
		for (const ch of TRACE_CHARS) {
			const paths = tracingPaths(ch);
			expect(strokeCount(ch)).toBeGreaterThan(0);
			// Per stroke: 1 ring + 3 arrow lines at least, plus dots.
			expect(paths.length).toBeGreaterThan(strokeCount(ch) * 4 + 5);
			expect(paths.filter((p) => p.length === 2).length).toBe(strokeCount(ch) * 3);
			for (const p of paths)
				for (const c of p) {
					if (c[0] === 'Z') continue;
					expect(c[1]).toBeGreaterThanOrEqual(0);
					expect(c[1]).toBeLessThanOrEqual(PAGE_SIZE.w);
					expect(c[2]).toBeGreaterThanOrEqual(0);
					expect(c[2]).toBeLessThanOrEqual(PAGE_SIZE.h);
				}
		}
	});
	it('is dotted: the guide is mostly tiny circles a gap apart', () => {
		const dots = tracingPaths('L').filter((p) => p[0][0] === 'E' && p[0][3] < 5);
		expect(dots.length).toBeGreaterThan(15);
		const [a, b] = dots;
		const dist = Math.hypot(
			(a[0][1] as number) - (b[0][1] as number),
			(a[0][2] as number) - (b[0][2] as number)
		);
		expect(dist).toBeLessThanOrEqual(DOT_GAP + 0.001);
	});
	it('returns nothing for an unknown glyph', () => {
		expect(tracingPaths('a')).toEqual([]);
		expect(strokeCount('a')).toBe(0);
	});
	it('flows through the page machinery and labels', () => {
		expect(pageDrawing(traceId('K'))).toEqual(tracingPaths('K'));
		expect(pageLabel(traceId('7'))).toBe('Trace 7');
		expect(pageLabel('house')).toBe('House');
		const scaled = pagePaths(traceId('A'), { w: 500, h: 350 });
		expect(scaled.length).toBe(tracingPaths('A').length);
	});
});
