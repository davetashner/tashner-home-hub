import { describe, expect, it } from 'vitest';
import { floodFill, gapFill, isFill, makeFill, spanArea } from './drawing-fill.js';

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
		// Mutation testing instruments every expression (it defines globalThis.__stryker__),
		// which makes this ~10x slower; the timing guard only means something on real code.
		if (!('__stryker__' in globalThis)) expect(performance.now() - t).toBeLessThan(20000);
		// The per-test timeout must exceed the budget above, or vitest's 5 s default
		// fires first on a loaded CI runner and the 20 s guard never gets to decide.
	}, 30000);
});

/** A 2 px thick ring of radius 12 around (20, 20) on a 41x41 board, with an opening `gap` px wide on its right. */
function ring(gap: number) {
	return buf(41, 41, (x, y) => {
		const d = Math.hypot(x - 20, y - 20);
		const open = x > 28 && Math.abs(y - 20) * 2 < gap;
		return d >= 11 && d <= 13 && !open ? BLACK : null;
	});
}
/** The pixel indexes a span list covers, for order-free comparison. */
const pixels = (spans: Uint32Array, w = 41) => {
	const out = new Set<number>();
	for (let i = 0; i < spans.length; i += 3)
		for (let x = spans[i + 1]; x <= spans[i + 2]; x++) out.add(spans[i] * w + x);
	return out;
};
const inDisc = (spans: Uint32Array, r: number) => {
	for (let i = 0; i < spans.length; i += 3)
		for (let x = spans[i + 1]; x <= spans[i + 2]; x++)
			if (Math.hypot(x - 20, spans[i] - 20) > r) return false;
	return true;
};

describe('gapFill', () => {
	it('leaks out of a ring with an opening without a gap, and stays inside with one', () => {
		const d = ring(4);
		const plain = gapFill(d, 41, 41, 20, 20, 48, 0);
		expect(spanArea(plain)).toBe(spanArea(floodFill(d, 41, 41, 20, 20)));
		expect(inDisc(plain, 14)).toBe(false);
		const bridged = gapFill(d, 41, 41, 20, 20, 48, 3);
		// The inside is filled right up to the line (within a few px at the opening only).
		const inside = floodFill(ring(0), 41, 41, 20, 20);
		expect(inDisc(bridged, 16)).toBe(true);
		expect(spanArea(bridged)).toBeGreaterThanOrEqual(spanArea(inside));
		expect(spanArea(bridged)).toBeLessThan(spanArea(inside) + 20);
	});
	it('fills a closed shape exactly like the plain flood', () => {
		const d = ring(0);
		expect(pixels(gapFill(d, 41, 41, 20, 20, 48, 3))).toEqual(pixels(floodFill(d, 41, 41, 20, 20)));
	});
	it('never paints more than the plain flood, so it never crosses a line', () => {
		const d = ring(4);
		const plain = pixels(floodFill(d, 41, 41, 2, 2));
		const out = gapFill(d, 41, 41, 2, 2, 48, 3);
		for (const p of pixels(out)) expect(plain.has(p)).toBe(true);
		// Outside the ring: everything except the ring's inside (give or take the opening).
		expect(spanArea(out)).toBeGreaterThan(41 * 41 - 600);
	});
	it('falls back to the plain flood in a passage narrower than the gap', () => {
		// A 3 px corridor between two walls.
		const d = buf(30, 9, (_x, y) => (y === 2 || y === 6 ? BLACK : null));
		expect(pixels(gapFill(d, 30, 9, 10, 4, 48, 3), 30)).toEqual(
			pixels(floodFill(d, 30, 9, 10, 4), 30)
		);
	});
	it('is the plain flood for no gap or a seed off the board', () => {
		const d = ring(4);
		expect(gapFill(d, 41, 41, 20, 20, 48, 0.5)).toEqual(floodFill(d, 41, 41, 20, 20));
		expect(gapFill(d, 41, 41, -1, 20, 48, 3).length).toBe(0);
	});
	it('fills a 4K canvas quickly', () => {
		const w = 3840,
			h = 2160;
		const d = new Uint8ClampedArray(w * h * 4).fill(255);
		const t = performance.now();
		expect(spanArea(gapFill(d, w, h, 100, 100, 48, 16))).toBe(w * h);
		if (!('__stryker__' in globalThis)) expect(performance.now() - t).toBeLessThan(20000);
	}, 30000);
});

describe('makeFill', () => {
	it('builds an item that remembers the tap and canvas size', () => {
		const f = makeFill(buf(5, 5), 5, 5, 2.7, 1.2, 'draw-red');
		expect(f && isFill(f)).toBe(true);
		expect(f).toMatchObject({ x: 2, y: 1, w: 5, h: 5, color: 'draw-red' });
		expect(spanArea(f!.spans)).toBe(25);
	});
	it('remembers the gap it bridged', () => {
		expect(makeFill(buf(5, 5), 5, 5, 2, 2, 'draw-red', 48, 2.6)).toMatchObject({ gap: 2 });
		expect(makeFill(buf(5, 5), 5, 5, 2, 2, 'draw-red')).not.toHaveProperty('gap');
	});
	it('is null off canvas', () => {
		expect(makeFill(buf(5, 5), 5, 5, 9, 9, 'draw-red')).toBeNull();
	});
	it('isFill rejects strokes', () => {
		expect(isFill({ tool: 'pen' })).toBe(false);
	});
});

describe('floodFill matches a plain flood on random boards', () => {
	/** Reference: 4-way breadth-first fill with the same per-channel tolerance. */
	function naive(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, tol: number) {
		const at = (px: number, py: number) => (py * w + px) * 4;
		const s = at(x, y);
		const same = (px: number, py: number) => {
			const i = at(px, py);
			return [0, 1, 2, 3].every((k) => Math.abs(d[i + k] - d[s + k]) <= tol);
		};
		const seen = new Set<number>();
		const queue = [[x, y]];
		while (queue.length) {
			const [px, py] = queue.pop()!;
			if (px < 0 || py < 0 || px >= w || py >= h || seen.has(py * w + px) || !same(px, py))
				continue;
			seen.add(py * w + px);
			queue.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
		}
		return seen;
	}
	const area = (spans: Uint32Array) => {
		const out = new Set<number>();
		for (let i = 0; i < spans.length; i += 3)
			for (let px = spans[i + 1]; px <= spans[i + 2]; px++) out.add(spans[i] * 40 + px);
		return out;
	};
	it('agrees for several seeds, tolerances and buffer alignments', () => {
		let seed = 7;
		const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
		const w = 40;
		const h = 30;
		for (let round = 0; round < 12; round++) {
			const raw = new Uint8ClampedArray(w * h * 4 + 1);
			for (let i = 0; i < raw.length; i++) raw[i] = rnd() < 0.7 ? 0 : Math.floor(rnd() * 256);
			// Round 1 in 2 views the pixels at an odd byte offset, which cannot use the 32-bit path.
			const d = round % 2 ? raw.subarray(1) : raw.subarray(0, w * h * 4);
			const x = Math.floor(rnd() * w);
			const y = Math.floor(rnd() * h);
			const tol = [0, 10, 48][round % 3];
			expect(area(floodFill(d, w, h, x, y, tol))).toEqual(naive(d, w, h, x, y, tol));
		}
	});
});
