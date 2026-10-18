/**
 * Paint-bucket fill (hub-cn7.6): a scanline flood fill over an ImageData-like RGBA buffer.
 * Pure and allocation-light so it stays fast on a 4K canvas: one visited byte per pixel and an
 * Int32 seed stack, each row run is scanned once. The result is a compact list of row runs
 * that the sheet replays with `fillRect`, so a fill is a vector-ish item that undo and redraw
 * can treat like any stroke.
 */

/** Default per-channel difference still counted as "the same color" (soaks up anti-aliased edges). */
export const FILL_TOLERANCE = 48;

/** A fill on the board. Coordinates are device pixels of a canvas `w` by `h`. */
export interface FillItem {
	fill: true;
	color: string;
	x: number;
	y: number;
	w: number;
	h: number;
	tolerance: number;
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
	const match = (p: number) => {
		const i = p * 4;
		return (
			Math.abs(data[i] - r) <= tolerance &&
			Math.abs(data[i + 1] - g) <= tolerance &&
			Math.abs(data[i + 2] - b) <= tolerance &&
			Math.abs(data[i + 3] - a) <= tolerance
		);
	};
	const seen = new Uint8Array(width * height);
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
		if (seen[row + px] || !match(row + px)) continue;
		let x0 = px;
		while (x0 > 0 && !seen[row + x0 - 1] && match(row + x0 - 1)) x0--;
		let x1 = px;
		while (x1 < width - 1 && !seen[row + x1 + 1] && match(row + x1 + 1)) x1++;
		for (px = x0; px <= x1; px++) seen[row + px] = 1;
		out.push(py, x0, x1);
		// Seed one point per contiguous matching stretch on the rows above and below.
		for (const ny of [py - 1, py + 1]) {
			if (ny < 0 || ny >= height) continue;
			row = ny * width;
			let open = false;
			for (px = x0; px <= x1; px++) {
				const ok = !seen[row + px] && match(row + px);
				if (ok && !open) push(px, ny);
				open = ok;
			}
		}
	}
	return Uint32Array.from(out);
}

/** Number of pixels a span list covers. */
export function spanArea(spans: Uint32Array): number {
	let n = 0;
	for (let i = 0; i < spans.length; i += 3) n += spans[i + 2] - spans[i + 1] + 1;
	return n;
}

/** A fill item for a tap at (x, y), or null when the tap is off the canvas. */
export function makeFill(
	data: Uint8ClampedArray | Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	color: string,
	tolerance = FILL_TOLERANCE
): FillItem | null {
	const spans = floodFill(data, width, height, x, y, tolerance);
	if (!spans.length) return null;
	return {
		fill: true,
		color,
		x: Math.floor(x),
		y: Math.floor(y),
		w: width,
		h: height,
		tolerance,
		spans
	};
}
