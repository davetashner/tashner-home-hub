import { describe, expect, it } from 'vitest';
import { floodFill, isFill, makeFill, spanArea } from './drawing-fill.js';

/** A w*h buffer of white, with `paint(x, y)` able to override pixels. */
function buf(w: number, h: number, paint: (x: number, y: number) => number[] | null = () => null) {
	const d = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) d.set(paint(x, y) ?? [255, 255, 255, 255], (y * w + x) * 4);
	return d;
}
const BLACK = [0, 0, 0, 255];

describe('floodFill', () => {
	it('fills a whole blank canvas', () => {
		expect(spanArea(floodFill(buf(10, 8), 10, 8, 3, 3))).toBe(80);
	});
	it('stops at a closed wall', () => {
		const d = buf(9, 9, (x, y) =>
			x >= 2 && x <= 6 && y >= 2 && y <= 6 && (x === 2 || x === 6 || y === 2 || y === 6)
				? BLACK
				: null
		);
		expect(spanArea(floodFill(d, 9, 9, 4, 4))).toBe(9);
		expect(spanArea(floodFill(d, 9, 9, 0, 0))).toBe(81 - 25);
	});
	it('does not leak diagonally through a corner gap', () => {
		const d = buf(4, 4, (x, y) => (x === y ? BLACK : null));
		expect(spanArea(floodFill(d, 4, 4, 0, 3))).toBe(6);
	});
	it('follows a serpentine corridor', () => {
		// Walls on odd rows, each with one gap at alternating ends.
		const gap = (y: number) => (y === 1 ? 6 : y === 3 ? 0 : 6);
		const d = buf(7, 7, (x, y) => (y % 2 === 1 && x !== gap(y) ? BLACK : null));
		expect(spanArea(floodFill(d, 7, 7, 0, 0))).toBe(7 * 4 + 3);
	});
	it('respects tolerance for near colors', () => {
		const d = buf(4, 1, (x) => (x === 2 ? [230, 230, 230, 255] : null));
		expect(spanArea(floodFill(d, 4, 1, 0, 0, 10))).toBe(2);
		expect(spanArea(floodFill(d, 4, 1, 0, 0, 40))).toBe(4);
	});
	it('treats transparent pixels as one color', () => {
		const d = new Uint8ClampedArray(3 * 3 * 4);
		expect(spanArea(floodFill(d, 3, 3, 1, 1))).toBe(9);
	});
	it('returns nothing for an out-of-bounds seed', () => {
		expect(floodFill(buf(3, 3), 3, 3, -1, 0).length).toBe(0);
		expect(floodFill(buf(3, 3), 3, 3, 0, 3).length).toBe(0);
		expect(floodFill(buf(3, 3), 3, 3, 3, 0).length).toBe(0);
	});
	it('does not modify the buffer', () => {
		const d = buf(3, 3);
		const copy = d.slice();
		floodFill(d, 3, 3, 1, 1);
		expect(d).toEqual(copy);
	});
	it('handles a comb that needs many seeds', () => {
		const comb = buf(41, 41, (x, y) =>
			x % 2 === 1 && y !== (x % 4 === 1 ? 0 : 40) ? BLACK : null
		);
		// Everything is reachable through the alternating top/bottom gaps.
		expect(spanArea(floodFill(comb, 41, 41, 0, 20))).toBe(41 * 41 - 20 * 40);
	});
	it('fills a 4K canvas quickly', () => {
		const w = 3840,
			h = 2160;
		const d = new Uint8ClampedArray(w * h * 4).fill(255);
		// Generous: coverage instrumentation slows this a lot; it only guards against a quadratic blowup.
		const t = performance.now();
		expect(spanArea(floodFill(d, w, h, 100, 100))).toBe(w * h);
		expect(performance.now() - t).toBeLessThan(20000);
	});
});

describe('makeFill', () => {
	it('builds an item that remembers the tap and canvas size', () => {
		const f = makeFill(buf(5, 5), 5, 5, 2.7, 1.2, 'draw-red');
		expect(f && isFill(f)).toBe(true);
		expect(f).toMatchObject({ x: 2, y: 1, w: 5, h: 5, color: 'draw-red' });
		expect(spanArea(f!.spans)).toBe(25);
	});
	it('is null off canvas', () => {
		expect(makeFill(buf(5, 5), 5, 5, 9, 9, 'draw-red')).toBeNull();
	});
	it('isFill rejects strokes', () => {
		expect(isFill({ tool: 'pen' })).toBe(false);
	});
});
