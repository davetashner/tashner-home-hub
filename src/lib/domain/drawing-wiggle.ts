/**
 * Wiggle (hub-t27j.4): the classic "boiling line" cartoon look. While Wiggle is on, the board
 * repaints every pen/brush stroke and shape a few times a second, each time nudged a hair by a
 * small deterministic offset, cycling through a few variants. The stored strokes never change;
 * only the painted copy moves. Pure: no canvas, no timers, no randomness (the same variant of the
 * same item always gives the same points).
 */
import { isShape, type DrawItem, type DrawPoint, type Shape, type Stroke } from './drawing.js';
import { isFill } from './drawing-fill.js';
import { isText } from './drawing-text.js';

/** How many distinct looks the lines cycle through. */
export const WIGGLE_VARIANTS = 3;
/** Repaints per second (a hand-drawn cartoon "on threes" feel). */
export const WIGGLE_FPS = 9;
/** The most a point ever moves along either axis, in CSS px. */
export const WIGGLE_AMPLITUDE = 1.8;

/** A stable 0..1 value for (item, variant, salt): a tiny integer hash, no Math.random. */
function unit(item: number, variant: number, salt: number): number {
	let h =
		(Math.imul(item + 1, 374761393) ^
			Math.imul(variant + 1, 668265263) ^
			Math.imul(salt + 1, 2147483647)) >>>
		0;
	h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The variant (0..WIGGLE_VARIANTS-1) showing at `ms` since the loop began. */
export function variantAt(ms: number): number {
	if (!Number.isFinite(ms) || ms < 0) return 0;
	return Math.floor((ms * WIGGLE_FPS) / 1000) % WIGGLE_VARIANTS;
}

/** A bad variant (NaN, negative, too big) wraps into range rather than throwing. */
const norm = (v: number) =>
	Number.isFinite(v) ? ((Math.trunc(v) % WIGGLE_VARIANTS) + WIGGLE_VARIANTS) % WIGGLE_VARIANTS : 0;

/**
 * The offset of point `i` of item `item` in `variant`. A slow wave along the line (so neighbors
 * move together and the line wobbles instead of fuzzing) with a per-item phase per variant.
 */
export function wiggleOffset(
	item: number,
	variant: number,
	i: number,
	amp = WIGGLE_AMPLITUDE
): { dx: number; dy: number } {
	const v = norm(variant);
	const px = unit(item, v, 1) * Math.PI * 2;
	const py = unit(item, v, 2) * Math.PI * 2;
	return { dx: amp * Math.sin(i * 0.45 + px), dy: amp * Math.sin(i * 0.37 + py) };
}

/** `points` nudged for `variant`; the input is never changed. */
export function wigglePoints(
	points: readonly DrawPoint[],
	item: number,
	variant: number,
	amp = WIGGLE_AMPLITUDE
): DrawPoint[] {
	return points.map((p, i) => {
		const { dx, dy } = wiggleOffset(item, variant, i, amp);
		return { ...p, x: p.x + dx, y: p.y + dy };
	});
}

/**
 * The item to paint in `variant`: strokes and shapes wiggle (a shape's corners move
 * independently by a hair); fills and text stay put. Returns the same object when nothing moves.
 */
export function wiggleItem(it: DrawItem, index: number, variant: number): DrawItem {
	if (isFill(it) || isText(it)) return it;
	if (isShape(it)) {
		const a = wiggleOffset(index, variant, 0);
		const b = wiggleOffset(index, variant, 5);
		const s: Shape = {
			...it,
			x0: it.x0 + a.dx,
			y0: it.y0 + a.dy,
			x1: it.x1 + b.dx,
			y1: it.y1 + b.dy
		};
		return s;
	}
	// The eraser must keep cutting exactly where it was drawn.
	if (it.tool === 'eraser') return it;
	const st: Stroke = { ...it, points: wigglePoints(it.points, index, variant) };
	return st;
}

/** Every item in `variant`. */
export const wiggleItems = (items: readonly DrawItem[], variant: number): DrawItem[] =>
	items.map((it, i) => wiggleItem(it, i, variant));
