// hub-cn7.24: the drawing board's view (pinch to zoom, two-finger pan). The view is a CSS transform
// with origin at the board's top-left: a board point b shows at b * scale + (x, y) inside the holder.

export type Pt = { x: number; y: number };
export type View = { scale: number; x: number; y: number };
export type Size = { w: number; h: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const FIT: View = { scale: 1, x: 0, y: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keep the board covering the holder, so it can never be panned or zoomed out of sight. */
export function clampView(v: View, size: Size): View {
	const scale = clamp(Number.isFinite(v.scale) ? v.scale : 1, MIN_SCALE, MAX_SCALE);
	return {
		scale,
		x: clamp(v.x, size.w * (1 - scale), 0) || 0,
		y: clamp(v.y, size.h * (1 - scale), 0) || 0
	};
}

/** A point in the holder (screen) to the board point under it. */
export const toBoard = (v: View, p: Pt): Pt => ({
	x: (p.x - v.x) / v.scale,
	y: (p.y - v.y) / v.scale
});

/** A board point to where it shows in the holder. */
export const toScreen = (v: View, p: Pt): Pt => ({
	x: p.x * v.scale + v.x,
	y: p.y * v.scale + v.y
});

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const distance = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The view after the two fingers move from (a0, b0) to (a1, b1): the board point that was under the
 * old midpoint ends up under the new one (that is the pan), scaled by how far the fingers spread.
 */
export function pinch(v: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt, size: Size): View {
	const d0 = distance(a0, b0);
	const scale = clamp(d0 > 0 ? (v.scale * distance(a1, b1)) / d0 : v.scale, MIN_SCALE, MAX_SCALE);
	const anchor = toBoard(v, midpoint(a0, b0));
	const m = midpoint(a1, b1);
	return clampView({ scale, x: m.x - anchor.x * scale, y: m.y - anchor.y * scale }, size);
}

export const isFit = (v: View): boolean => v.scale === 1 && v.x === 0 && v.y === 0;
export const viewCss = (v: View): string => `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
