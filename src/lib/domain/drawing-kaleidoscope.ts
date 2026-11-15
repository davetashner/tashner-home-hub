/**
 * Kaleidoscope mode (hub-t27j.1): like Mirror, but radial. A stroke is drawn in 6 or 8 slices
 * turned around the board center, and each slice is reflected so the pattern is a true
 * snowflake or mandala (dihedral symmetry: n/2 turns, each with its mirror image).
 *
 * It rides on the Mirror stroke field: a kaleidoscope stroke carries `mirror: { n, cx, cy, rot: true }`,
 * so every brush, one undo step and the saved form (`m: [n, cx, cy, 1]`) all work the same way.
 * Pure: no canvas.
 */
export const KALEIDOSCOPE_MODES = [6, 8] as const;
export type KaleidoscopeCount = (typeof KALEIDOSCOPE_MODES)[number];

export const isKaleidoscopeCount = (v: unknown): v is KaleidoscopeCount =>
	(KALEIDOSCOPE_MODES as readonly unknown[]).includes(v);

/** Off -> 6 -> 8 -> off. */
export function nextKaleidoscope(n: KaleidoscopeCount | null): KaleidoscopeCount | null {
	if (n === null) return KALEIDOSCOPE_MODES[0];
	return KALEIDOSCOPE_MODES[KALEIDOSCOPE_MODES.indexOf(n) + 1] ?? null;
}

export const kaleidoscopeLabel = (n: KaleidoscopeCount | null): string =>
	n === null ? 'Off' : `${n} slices`;

/**
 * Copy `k` (0 is the original) of the offset (dx, dy) from the center: even copies are turns by
 * k/2 steps of 360/(n/2) degrees, odd copies are the reflection of the matching turn.
 */
export function kaleidoscopeOffset(
	dx: number,
	dy: number,
	n: number,
	k: number
): { x: number; y: number } {
	const turns = n / 2;
	const a = (2 * Math.PI * Math.floor(k / 2)) / turns;
	const flip = k % 2 === 1;
	const y = flip ? -dy : dy;
	const cos = Math.cos(a);
	const sin = Math.sin(a);
	return { x: dx * cos - y * sin, y: dx * sin + y * cos };
}

/** Faint overlay: n/2 lines through the center, one per mirror axis. */
export function kaleidoscopeGuides(
	n: number,
	size: { w: number; h: number }
): { x1: number; y1: number; x2: number; y2: number }[] {
	const cx = size.w / 2;
	const cy = size.h / 2;
	const r = Math.hypot(size.w, size.h) / 2;
	return Array.from({ length: n / 2 }, (_, i) => {
		const a = (Math.PI * i) / (n / 2);
		const ux = Math.cos(a) * r;
		const uy = Math.sin(a) * r;
		return { x1: cx - ux, y1: cy - uy, x2: cx + ux, y2: cy + uy };
	});
}
