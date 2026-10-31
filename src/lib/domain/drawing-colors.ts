/**
 * Extra ink colors and opacity steps for the drawing board (hub-cn7.13): white, greys, browns
 * and skin tones (all oklch, like COLOR_GRID), plus the pen and shape opacity choices. Pure.
 */

import { COLOR_GRID } from './drawing.js';

const mixColor = (l: number, c: number, h: number): string => `oklch(${l}% ${c} ${h})`;

/** White, then light to dark greys (no chroma). */
export const NEUTRAL_COLORS: readonly string[] = [100, 90, 78, 66, 54, 42, 30, 18].map((l) =>
	lch(l, 0, 0)
);
/** Tan to deep brown. */
export const BROWN_COLORS: readonly string[] = (
	[
		[85, 0.06, 70],
		[72, 0.09, 65],
		[68, 0.12, 80],
		[60, 0.11, 60],
		[50, 0.1, 55],
		[42, 0.09, 50],
		[34, 0.07, 50],
		[26, 0.05, 45]
	] as const
).map(([l, c, h]) => lch(l, c, h));
/** Light to deep skin tones. */
export const SKIN_COLORS: readonly string[] = (
	[
		[92, 0.04, 65],
		[85, 0.06, 65],
		[78, 0.08, 62],
		[70, 0.09, 60],
		[60, 0.09, 55],
		[50, 0.08, 52],
		[40, 0.07, 50],
		[30, 0.05, 48]
	] as const
).map(([l, c, h]) => lch(l, c, h));

/** Colors added after the first grid, in picker order. */
export const EXTRA_COLORS: readonly string[] = [...NEUTRAL_COLORS, ...BROWN_COLORS, ...SKIN_COLORS];
/** Every color the pickers offer and a saved background may use. */
export const PALETTE: readonly string[] = [...COLOR_GRID, ...EXTRA_COLORS];

/** Kid-friendly opacity steps for pen strokes and shapes, most opaque first. */
export const OPACITY_STEPS = [1, 0.75, 0.5, 0.25] as const;

/** A usable opacity: finite and within 10-100%. Anything else reads as fully opaque. */
export const clampAlpha = (a: unknown): number =>
	typeof a === 'number' && Number.isFinite(a) ? Math.min(1, Math.max(0.1, a)) : 1;
export const isTranslucent = (a: number | undefined): a is number => a !== undefined && a < 1;
