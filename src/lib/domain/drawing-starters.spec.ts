import { describe, expect, it } from 'vitest';
import { DRAWING_PROMPTS } from './drawing-prompts.js';
import { PAGE_SIZE, pageFit } from './drawing-pages.js';
import { FIXED_WIDTH } from './drawing.js';
import { STARTER_PROMPTS, hasStarter } from './drawing-starter-names.js';
import { SKETCHED_PROMPTS, flattenPath, starterPaths, starterStrokes } from './drawing-starters.js';

describe('starters', () => {
	it('belong to real prompts, a first batch of at least a dozen', () => {
		expect(STARTER_PROMPTS.length).toBeGreaterThanOrEqual(12);
		for (const p of STARTER_PROMPTS) expect(DRAWING_PROMPTS, p).toContain(p);
	});
	it('list exactly the prompts that have a sketch', () => {
		expect([...STARTER_PROMPTS].sort()).toEqual([...SKETCHED_PROMPTS].sort());
	});
	it('know which prompts have one', () => {
		expect(hasStarter('Draw a dog driving a bus')).toBe(true);
		expect(hasStarter('Draw something with no starter')).toBe(false);
		expect(hasStarter('toString')).toBe(false);
		expect(starterPaths('Draw something with no starter')).toBeNull();
	});
	it('stay on the page', () => {
		for (const p of STARTER_PROMPTS)
			for (const run of starterPaths(p)!.flatMap(flattenPath))
				for (const [x, y] of run) {
					expect(x, p).toBeGreaterThanOrEqual(0);
					expect(x, p).toBeLessThanOrEqual(PAGE_SIZE.w);
					expect(y, p).toBeGreaterThanOrEqual(0);
					expect(y, p).toBeLessThanOrEqual(PAGE_SIZE.h);
				}
	});
});

describe('flattenPath', () => {
	it('splits subpaths and closes outlines', () => {
		expect(
			flattenPath([['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z'], ['M', 50, 50], ['L', 60, 60]])
		).toEqual([
			[
				[0, 0],
				[10, 0],
				[10, 10],
				[0, 0]
			],
			[
				[50, 50],
				[60, 60]
			]
		]);
	});
	it('samples curves and ellipses into closed runs', () => {
		const [curve] = flattenPath([
			['M', 0, 0],
			['C', 0, 10, 10, 10, 10, 0]
		]);
		expect(curve[0]).toEqual([0, 0]);
		expect(curve[curve.length - 1]).toEqual([10, 0]);
		expect(curve.length).toBeGreaterThan(10);
		const [ring] = flattenPath([['E', 100, 100, 20, 10]]);
		expect(ring[0][0]).toBeCloseTo(120);
		expect(ring[ring.length - 1][0]).toBeCloseTo(120);
		expect(Math.max(...ring.map((p) => p[1]))).toBeCloseTo(110);
	});
	it('drops lone points and curves with no start', () => {
		expect(flattenPath([['M', 1, 1]])).toEqual([]);
		expect(flattenPath([['C', 0, 0, 1, 1, 2, 2]])).toEqual([]);
		expect(flattenPath([['M', 1, 1], ['Z']])).toEqual([]);
	});
});

describe('starterStrokes', () => {
	it('fits the sketch to the canvas as black pen strokes', () => {
		const canvas = { w: 1600, h: 900 };
		const fit = pageFit(canvas);
		const strokes = starterStrokes('Draw a dog driving a bus', canvas);
		expect(strokes.length).toBeGreaterThan(5);
		for (const s of strokes) {
			expect(s).toMatchObject({ tool: 'pen', color: 'draw-black' });
			expect(s.points.length).toBeGreaterThan(1);
			for (const p of s.points) {
				expect(p.w).toBe(FIXED_WIDTH);
				expect(p.x).toBeGreaterThanOrEqual(fit.ox - 0.1);
				expect(p.x).toBeLessThanOrEqual(fit.ox + PAGE_SIZE.w * fit.s + 0.1);
			}
		}
		// The bus body's top-left corner (180, 260) in page space.
		expect(strokes[0].points[0]).toEqual({
			x: Math.round((fit.ox + 180 * fit.s) * 10) / 10,
			y: Math.round((fit.oy + 260 * fit.s) * 10) / 10,
			w: FIXED_WIDTH
		});
	});
	it('is empty for a prompt without a starter', () => {
		expect(starterStrokes('Draw something with no starter', { w: 800, h: 600 })).toEqual([]);
	});
});
