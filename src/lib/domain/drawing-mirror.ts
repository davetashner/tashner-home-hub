/**
 * Mirror mode (hub-cn7.18): a pen, highlighter or eraser stroke is drawn in 2, 4 or 8 places at
 * once, reflected about a center point (the board center when the stroke began).
 *
 * A mirrored stroke is still ONE stroke item: it carries `mirror: { n, cx, cy }` and is painted
 * once per copy, so it is a single undo step and a single saved item. Saved drawings store the
 * mirror setting (not the copies) as the optional `m: [n, cx, cy]` on a wire stroke; the center
 * moves with the drawing when it is refitted to another board size, so a reopened drawing is
 * identical. Pure: no canvas.
 */
export const MIRROR_MODES = [2, 4, 8] as const;
export type MirrorCount = (typeof MIRROR_MODES)[number];

/** n copies reflected about (cx, cy), in CSS px of the board the stroke was drawn on. */
export interface Mirror {
	n: MirrorCount;
	cx: number;
	cy: number;
}

export const isMirrorCount = (v: unknown): v is MirrorCount =>
	(MIRROR_MODES as readonly unknown[]).includes(v);

/** Off -> 2-way -> 4-way -> 8-way -> off. */
export function nextMirror(n: MirrorCount | null): MirrorCount | null {
	if (n === null) return MIRROR_MODES[0];
	const i = MIRROR_MODES.indexOf(n);
	return MIRROR_MODES[i + 1] ?? null;
}

export const mirrorLabel = (n: MirrorCount | null): string =>
	n === null ? 'Off' : n === 2 ? '2-way' : n === 4 ? '4-way' : '8-way';

/**
 * Copy `k` (0 is the original) of point (x, y). 2-way flips left/right; 4-way adds up/down;
 * 8-way adds the four diagonal turns (a kaleidoscope).
 */
export function mirrorPoint(x: number, y: number, m: Mirror, k: number): { x: number; y: number } {
	const dx = x - m.cx;
	const dy = y - m.cy;
	const [a, b] = [
		[dx, dy],
		[-dx, dy],
		[dx, -dy],
		[-dx, -dy],
		[dy, dx],
		[-dy, dx],
		[dy, -dx],
		[-dy, -dx]
	][k % 8];
	return { x: m.cx + a, y: m.cy + b };
}

/** Every position of a point: the original first, then its reflections. */
export const mirrorPoints = (x: number, y: number, m: Mirror): { x: number; y: number }[] =>
	Array.from({ length: m.n }, (_, k) => mirrorPoint(x, y, m, k));

/** A mirror whose center is the middle of a board of `size` CSS px. */
export const centeredMirror = (n: MirrorCount, size: { w: number; h: number }): Mirror => ({
	n,
	cx: size.w / 2,
	cy: size.h / 2
});

/** Guide axes as line segments across a board, for the faint overlay (never exported). */
export function mirrorGuides(
	n: MirrorCount,
	size: { w: number; h: number }
): { x1: number; y1: number; x2: number; y2: number }[] {
	const cx = size.w / 2;
	const cy = size.h / 2;
	const lines = [{ x1: cx, y1: 0, x2: cx, y2: size.h }];
	if (n >= 4) lines.push({ x1: 0, y1: cy, x2: size.w, y2: cy });
	if (n === 8) {
		const r = Math.max(size.w, size.h);
		lines.push(
			{ x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r },
			{ x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r }
		);
	}
	return lines;
}

/** Wire form `[n, cx, cy]` for a stroke's mirror, or undefined. */
export const mirrorWire = (
	m: Mirror | undefined,
	X: (x: number) => number,
	Y: (y: number) => number
) => (m ? [m.n, X(m.cx), Y(m.cy)] : undefined);

/** A mirror from its wire form, or null when malformed. */
export function parseMirrorWire(
	v: unknown,
	X: (x: number) => number = (x) => x,
	Y: (y: number) => number = (y) => y
): Mirror | null {
	if (!Array.isArray(v) || v.length !== 3) return null;
	const [n, cx, cy] = v;
	if (!isMirrorCount(n) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
	return { n, cx: X(cx), cy: Y(cy) };
}
