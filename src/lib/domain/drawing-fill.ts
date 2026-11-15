/**
 * Paint-bucket fill (hub-cn7.6): a scanline flood fill over an ImageData-like RGBA buffer.
 * Pure and allocation-light so it stays fast on a 4K canvas: one visited byte per pixel and an
 * Int32 seed stack, each row run is scanned once. The result is a compact list of row runs
 * that the sheet replays with `fillRect`, so a fill is a vector-ish item that undo and redraw
 * can treat like any stroke.
 */

import type { PatternId } from './drawing-pattern.js';

/** Default per-channel difference still counted as "the same color" (soaks up anti-aliased edges). */
export const FILL_TOLERANCE = 48;

/**
 * Openings the bucket bridges (hub-h3q), as a radius in CSS px: a hand-drawn circle with a gap up
 * to about twice this wide, or a crayon line with holes, still fills only its inside.
 */
export const FILL_GAP_CSS = 8;

/** A fill on the board. Coordinates are device pixels of a canvas `w` by `h`. */
export interface FillItem {
	fill: true;
	color: string;
	x: number;
	y: number;
	w: number;
	h: number;
	tolerance: number;
	/** Gap radius in device px the fill bridged (0 or absent: a plain flood). */
	gap?: number;
	/** Pattern painted in `color` through the runs (hub-t27j.2); absent: a solid fill. */
	pattern?: PatternId;
	/** Second color of a vertical gradient from `color` (hub-t27j.3); absent: no gradient. */
	grad?: string;
	/** Flat triples [y, x0, x1] (inclusive) of the filled runs. */
	spans: Uint32Array;
}
export const isFill = (item: object): item is FillItem => 'fill' in item;

/**
 * The runs of pixels connected (4-way) to (x, y) whose color is within `tolerance` of the seed's,
 * per channel including alpha. Does not modify the buffer. Empty when the seed is out of bounds.
 */
export function floodFill(
	data: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	tolerance = FILL_TOLERANCE
): Uint32Array {
	x = Math.floor(x);
	y = Math.floor(y);
	if (x < 0 || y < 0 || x >= width || y >= height) return new Uint32Array(0);
	const s = (y * width + x) * 4;
	const r = data[s],
		g = data[s + 1],
		b = data[s + 2],
		a = data[s + 3];
	const px32 =
		data.byteOffset % 4 === 0 && data.length === width * height * 4
			? new Uint32Array(data.buffer, data.byteOffset, width * height)
			: null;
	const seed32 = px32 ? px32[y * width + x] : 0;
	// Per pixel: 0 not looked at, 1 filled, 2 no match, 3 matches and not filled yet. Each pixel's
	// color is compared once, however many row scans reach it.
	const state = new Uint8Array(width * height);
	const match = (p: number) => {
		const st = state[p];
		if (st) return st === 3;
		let ok = px32 !== null && px32[p] === seed32;
		if (!ok) {
			const i = p * 4;
			ok =
				Math.abs(data[i] - r) <= tolerance &&
				Math.abs(data[i + 1] - g) <= tolerance &&
				Math.abs(data[i + 2] - b) <= tolerance &&
				Math.abs(data[i + 3] - a) <= tolerance;
		}
		state[p] = ok ? 3 : 2;
		return ok;
	};
	let stack = new Int32Array(1024);
	let top = 0;
	const push = (px: number, py: number) => {
		if (top + 2 > stack.length) {
			const bigger = new Int32Array(stack.length * 2);
			bigger.set(stack);
			stack = bigger;
		}
		stack[top++] = px;
		stack[top++] = py;
	};
	const out: number[] = [];
	push(x, y);
	while (top > 0) {
		const py = stack[--top];
		let px = stack[--top];
		let row = py * width;
		if (!match(row + px)) continue;
		let x0 = px;
		while (x0 > 0 && match(row + x0 - 1)) x0--;
		let x1 = px;
		while (x1 < width - 1 && match(row + x1 + 1)) x1++;
		for (px = x0; px <= x1; px++) state[row + px] = 1;
		out.push(py, x0, x1);
		// Seed one point per contiguous matching stretch on the rows above and below.
		for (const ny of [py - 1, py + 1]) {
			if (ny < 0 || ny >= height) continue;
			row = ny * width;
			let open = false;
			for (px = x0; px <= x1; px++) {
				const ok = match(row + px);
				if (ok && !open) push(px, ny);
				open = ok;
			}
		}
	}
	return Uint32Array.from(out);
}

/** 1 where the pixel is within `tolerance` of the seed's color (per channel, alpha included). */
function matchMask(
	data: Uint8ClampedArray | Uint8Array,
	n: number,
	s: number,
	tolerance: number
): Uint8Array {
	const r = data[s * 4],
		g = data[s * 4 + 1],
		b = data[s * 4 + 2],
		a = data[s * 4 + 3];
	const out = new Uint8Array(n);
	for (let p = 0, i = 0; p < n; p++, i += 4)
		out[p] =
			Math.abs(data[i] - r) <= tolerance &&
			Math.abs(data[i + 1] - g) <= tolerance &&
			Math.abs(data[i + 2] - b) <= tolerance &&
			Math.abs(data[i + 3] - a) <= tolerance
				? 1
				: 0;
	return out;
}

/**
 * 1 where a non-matching pixel lies within `r` steps (4-way, a diamond) of it: the walls,
 * thickened. A two-pass city-block distance transform, capped at r + 1. The diamond is exactly
 * what `growWithin` grows back, so the fill meets the real line again on diagonals too.
 */
function thickenWalls(match: Uint8Array, w: number, h: number, r: number): Uint8Array {
	const cap = r + 1;
	const d = new Uint16Array(w * h);
	for (let y = 0, p = 0; y < h; y++)
		for (let x = 0; x < w; x++, p++) {
			if (!match[p]) continue;
			let v = cap;
			if (y > 0 && d[p - w] + 1 < v) v = d[p - w] + 1;
			if (x > 0 && d[p - 1] + 1 < v) v = d[p - 1] + 1;
			d[p] = v;
		}
	const out = new Uint8Array(w * h);
	for (let y = h - 1, p = w * h - 1; y >= 0; y--)
		for (let x = w - 1; x >= 0; x--, p--) {
			let v = d[p];
			if (y < h - 1 && d[p + w] + 1 < v) v = d[p + w] + 1;
			if (x < w - 1 && d[p + 1] + 1 < v) v = d[p + 1] + 1;
			d[p] = v;
			out[p] = v <= r ? 1 : 0;
		}
	return out;
}

/** Marks (as 1 in a new mask) the pixels 4-way connected to `seed` where `blocked` is 0. */
function floodOpen(blocked: Uint8Array, w: number, h: number, seed: number): Uint8Array {
	const region = new Uint8Array(w * h);
	const stack: number[] = [seed];
	while (stack.length) {
		const p = stack.pop() as number;
		if (region[p] || blocked[p]) continue;
		const row = p - (p % w);
		let x0 = p - row;
		while (x0 > 0 && !blocked[row + x0 - 1] && !region[row + x0 - 1]) x0--;
		let x1 = p - row;
		while (x1 < w - 1 && !blocked[row + x1 + 1] && !region[row + x1 + 1]) x1++;
		region.fill(1, row + x0, row + x1 + 1);
		for (const nrow of [row - w, row + w]) {
			if (nrow < 0 || nrow >= w * h) continue;
			let open = false;
			for (let x = x0; x <= x1; x++) {
				const ok = !blocked[nrow + x] && !region[nrow + x];
				if (ok && !open) stack.push(nrow + x);
				open = ok;
			}
		}
	}
	return region;
}

/**
 * Grows `region` up to `steps` pixels (4-way) through matching pixels only, so the color reaches
 * the real line again but never crosses it.
 */
function growWithin(region: Uint8Array, match: Uint8Array, w: number, h: number, steps: number) {
	const n = w * h;
	const reach = (p: number, add: (q: number) => void) => {
		const x = p % w;
		if (x > 0) add(p - 1);
		if (x < w - 1) add(p + 1);
		if (p >= w) add(p - w);
		if (p < n - w) add(p + w);
	};
	let frontier: number[] = [];
	for (let p = 0; p < n; p++) {
		if (!region[p]) continue;
		let edge = false;
		reach(p, (q) => {
			if (!region[q] && match[q]) edge = true;
		});
		if (edge) frontier.push(p);
	}
	for (let step = 0; step < steps && frontier.length; step++) {
		const next: number[] = [];
		for (const p of frontier)
			reach(p, (q) => {
				if (!region[q] && match[q]) {
					region[q] = 1;
					next.push(q);
				}
			});
		frontier = next;
	}
}

/** Row runs [y, x0, x1] of a 0/1 mask. */
function maskSpans(mask: Uint8Array, w: number, h: number): Uint32Array {
	const out: number[] = [];
	for (let y = 0; y < h; y++) {
		const row = y * w;
		let x = 0;
		while (x < w) {
			if (!mask[row + x]) {
				x++;
				continue;
			}
			const x0 = x;
			while (x < w && mask[row + x]) x++;
			out.push(y, x0, x - 1);
		}
	}
	return Uint32Array.from(out);
}

/**
 * Like `floodFill`, but bridges openings in the walls up to about `2 * gap` px wide (hub-h3q): the
 * region is found with every wall thickened by `gap`, then grown back by `gap` through matching
 * pixels to meet the real line. Never paints more than `floodFill` would. Falls back to the plain
 * flood when the tap is in a passage narrower than the gap.
 */
export function gapFill(
	data: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	tolerance = FILL_TOLERANCE,
	gap = 0
): Uint32Array {
	x = Math.floor(x);
	y = Math.floor(y);
	gap = Math.floor(gap);
	if (gap < 1 || x < 0 || y < 0 || x >= width || y >= height)
		return floodFill(data, width, height, x, y, tolerance);
	const seed = y * width + x;
	const match = matchMask(data, width * height, seed, tolerance);
	const blocked = thickenWalls(match, width, height, gap);
	if (blocked[seed]) return floodFill(data, width, height, x, y, tolerance);
	const region = floodOpen(blocked, width, height, seed);
	growWithin(region, match, width, height, gap);
	return maskSpans(region, width, height);
}

/** Number of pixels a span list covers. */
export function spanArea(spans: Uint32Array): number {
	let n = 0;
	for (let i = 0; i < spans.length; i += 3) n += spans[i + 2] - spans[i + 1] + 1;
	return n;
}

/** A fill item for a tap at (x, y), bridging gaps up to `gap` px; null when the tap is off the canvas. */
export function makeFill(
	data: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	color: string,
	tolerance = FILL_TOLERANCE,
	gap = 0,
	pattern?: PatternId,
	grad?: string
): FillItem | null {
	const spans = gapFill(data, width, height, x, y, tolerance, gap);
	if (!spans.length) return null;
	return {
		fill: true,
		color,
		x: Math.floor(x),
		y: Math.floor(y),
		w: width,
		h: height,
		tolerance,
		...(gap >= 1 ? { gap: Math.floor(gap) } : {}),
		...(pattern ? { pattern } : {}),
		...(grad ? { grad } : {}),
		spans
	};
}
