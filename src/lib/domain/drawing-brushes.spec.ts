import { describe, expect, it } from 'vitest';
import {
	BRUSHES,
	BRUSH_TOOLS,
	MAX_DOTS_PER_SEGMENT,
	hashSeed,
	isBrushTool,
	isSeed,
	newSeed,
	seededRandom,
	segmentDots,
	washPasses
} from './drawing-brushes.js';
import { loadDrawing, serializeDrawing, isSavedDrawing } from './drawing-save.js';
import { isAlphaTool } from './drawing-brushes.js';
import { strokeWidth, type Stroke } from './drawing.js';

const A = { x: 10, y: 10 };
const B = { x: 40, y: 22 };

describe('seeded randomness', () => {
	it('repeats for a seed and differs across seeds and indexes', () => {
		const a = seededRandom(5);
		const b = seededRandom(5);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
		expect(hashSeed(1, 2)).toBe(hashSeed(1, 2));
		expect(hashSeed(1, 2)).not.toBe(hashSeed(1, 3));
		expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 2));
		const r = seededRandom(9);
		for (let i = 0; i < 50; i++) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
	it('makes valid seeds', () => {
		expect(isSeed(newSeed())).toBe(true);
		expect(isSeed(-1)).toBe(false);
		expect(isSeed(1.5)).toBe(false);
		expect(isSeed('3')).toBe(false);
		expect(isBrushTool('crayon')).toBe(true);
		expect(isBrushTool('pen')).toBe(false);
	});
});

describe('segmentDots', () => {
	it('is deterministic and stays within the brush footprint', () => {
		for (const tool of ['crayon', 'chalk', 'spray'] as const) {
			const d1 = segmentDots(BRUSHES[tool], 7, 3, A, B, 12);
			expect(segmentDots(BRUSHES[tool], 7, 3, A, B, 12)).toEqual(d1);
			expect(d1.length).toBeGreaterThan(0);
			expect(d1.length % 4).toBe(0);
			for (let i = 0; i < d1.length; i += 4) {
				expect(d1[i]).toBeGreaterThan(Math.min(A.x, B.x) - 8);
				expect(d1[i]).toBeLessThan(Math.max(A.x, B.x) + 8);
				expect([0, 1]).toContain(d1[i + 3]);
			}
		}
	});
	it('differs by seed and by segment', () => {
		const base = segmentDots(BRUSHES.crayon, 1, 1, A, B, 12);
		expect(segmentDots(BRUSHES.crayon, 2, 1, A, B, 12)).not.toEqual(base);
		expect(segmentDots(BRUSHES.crayon, 1, 2, A, B, 12)).not.toEqual(base);
	});
	it('handles a tap (zero length) and caps a huge segment', () => {
		expect(segmentDots(BRUSHES.spray, 1, 0, A, A, 20).length).toBeGreaterThan(0);
		const big = segmentDots(BRUSHES.crayon, 1, 0, A, { x: 4000, y: 10 }, 40);
		expect(big.length).toBeLessThanOrEqual(MAX_DOTS_PER_SEGMENT * 4);
	});
	it('spray concentrates near the centre line', () => {
		const d = segmentDots(BRUSHES.spray, 3, 0, { x: 0, y: 0 }, { x: 200, y: 0 }, 60);
		const near = d.filter((_, i) => i % 4 === 1 && Math.abs(d[i]) <= 15).length;
		expect(near).toBeGreaterThan(d.length / 4 / 2);
	});
});

describe('washPasses', () => {
	it('is deterministic with a wide base and narrower blooms', () => {
		const p = washPasses(4, 40);
		expect(washPasses(4, 40)).toEqual(p);
		expect(p[0].width).toBe(40);
		expect(p[1].width).toBeLessThan(p[0].width);
		expect(washPasses(5, 40)).not.toEqual(p);
	});
});

describe('brush widths and saving', () => {
	it('scales width per brush and keeps pen pressure', () => {
		const pen = strokeWidth('pen', 'pen', 1);
		expect(strokeWidth('crayon', 'pen', 1)).toBeCloseTo(pen * BRUSHES.crayon.widthScale);
		expect(strokeWidth('spray', 'pen', 1)).toBeGreaterThan(strokeWidth('spray', 'pen', 0.2));
		expect(strokeWidth('chalk', 'touch', 0)).toBeGreaterThan(0);
	});
	it('round-trips every brush with its seed, and old strokes load seedless', () => {
		const items: Stroke[] = BRUSH_TOOLS.map((tool, i) => ({
			tool,
			color: 'draw-red',
			seed: 100 + i,
			points: [
				{ x: 10, y: 10, w: 8 },
				{ x: 50, y: 30, w: 9 }
			]
		}));
		items.push({ tool: 'pen', color: 'draw-red', points: [{ x: 1, y: 2, w: 3 }] });
		const json = serializeDrawing(items, { w: 100, h: 100 });
		expect(isSavedDrawing(json)).toBe(true);
		const back = loadDrawing(json, { w: 100, h: 100 }) as Stroke[];
		expect(back.map((s) => s.seed)).toEqual([100, 101, 102, 103, 104, 105, undefined]);
		expect(back.map((s) => s.tool)).toEqual([...BRUSH_TOOLS, 'pen']);
		const old = JSON.stringify({
			v: 1,
			size: { w: 100, h: 100 },
			items: [{ t: 'pen', c: 'draw-red', p: [1, 2, 3] }]
		});
		expect(isSavedDrawing(old)).toBe(true);
		const bad = JSON.stringify({
			v: 1,
			size: { w: 100, h: 100 },
			items: [{ t: 'chalk', c: 'draw-red', p: [1, 2, 3], z: -4 }]
		});
		expect(isSavedDrawing(bad)).toBe(false);
	});
	it('keeps opacity on textured brushes and pens only', () => {
		expect(isAlphaTool('pen')).toBe(true);
		expect(isAlphaTool('spray')).toBe(true);
		expect(isAlphaTool('eraser')).toBe(false);
		expect(isAlphaTool('highlighter')).toBe(false);
		const items: Stroke[] = [
			{ tool: 'chalk', color: 'draw-red', seed: 9, alpha: 0.5, points: [{ x: 1, y: 2, w: 3 }] },
			{ tool: 'eraser', color: 'draw-red', alpha: 0.5, points: [{ x: 1, y: 2, w: 3 }] }
		];
		const back = loadDrawing(serializeDrawing(items, { w: 100, h: 100 }), {
			w: 100,
			h: 100
		}) as Stroke[];
		expect(back[0]).toMatchObject({ tool: 'chalk', seed: 9, alpha: 0.5 });
		expect(back[1].alpha).toBeUndefined();
	});
});
