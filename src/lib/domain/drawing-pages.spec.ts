import { describe, expect, it } from 'vitest';
import {
	PAGE_IDS,
	PAGE_LABELS,
	PAGE_SIZE,
	isPageId,
	pageDrawing,
	pageFit,
	pageLineWidth,
	pagePaths
} from './drawing-pages.js';

describe('coloring pages', () => {
	it('knows its pages', () => {
		for (const id of PAGE_IDS) {
			expect(isPageId(id)).toBe(true);
			expect(PAGE_LABELS[id]).toBeTruthy();
		}
		expect(isPageId('mickey')).toBe(false);
		expect(isPageId(7)).toBe(false);
	});
	it('keeps every path inside the page, starting with a move', () => {
		for (const id of PAGE_IDS) {
			const paths = pageDrawing(id);
			expect(paths.length).toBeGreaterThan(5);
			for (const p of paths) {
				expect(['M', 'E']).toContain(p[0][0]);
				for (const c of p) {
					const nums = c.slice(1) as number[];
					if (c[0] === 'E') {
						const [x, y, rx, ry] = nums;
						expect(x - rx).toBeGreaterThanOrEqual(0);
						expect(x + rx).toBeLessThanOrEqual(PAGE_SIZE.w);
						expect(y - ry).toBeGreaterThanOrEqual(0);
						expect(y + ry).toBeLessThanOrEqual(PAGE_SIZE.h);
					} else
						nums.forEach((n, i) => {
							expect(n).toBeGreaterThanOrEqual(0);
							expect(n).toBeLessThanOrEqual(i % 2 === 0 ? PAGE_SIZE.w : PAGE_SIZE.h);
						});
				}
			}
		}
	});
});

describe('fitting', () => {
	it('fills a same-shape canvas exactly', () => {
		expect(pageFit({ w: 2000, h: 1400 })).toEqual({ s: 2, ox: 0, oy: 0 });
	});
	it('centres without distorting in a taller canvas', () => {
		const f = pageFit({ w: 500, h: 700 });
		expect(f.s).toBe(0.5);
		expect(f.ox).toBe(0);
		expect(f.oy).toBe(175);
	});
	it('centres in a wider canvas', () => {
		const f = pageFit({ w: 2000, h: 700 });
		expect(f).toEqual({ s: 1, ox: 500, oy: 0 });
	});
	it('maps every command kind', () => {
		const out = pagePaths('garden', { w: 500, h: 350 }).flat();
		const kinds = new Set(out.map((c) => c[0]));
		expect(kinds).toEqual(new Set(['M', 'L', 'C', 'E', 'Z']));
		const sun = pagePaths('house', { w: 500, h: 350 }).find(
			(p) => p[0][0] === 'E' && p[0][3] === 27.5
		);
		expect(sun?.[0]).toEqual(['E', 425, 65, 27.5, 27.5]);
	});
	it('line width grows with the page but has a floor', () => {
		expect(pageLineWidth(0.1)).toBe(3);
		expect(pageLineWidth(2)).toBe(12);
	});
});
