/**
 * Gradient fills for the paint bucket (hub-t27j.3): a vertical two-color blend from the current
 * color (top) to a second color (bottom). It spans the filled region's own top and bottom rows
 * and is painted only through the region's runs, so it never leaves the area the bucket found.
 * Pure: the sheet turns `gradientStops` into a canvas gradient.
 */

import { PALETTE, NEUTRAL_COLORS } from './drawing-colors.js';

/** The fill style id the picker lists next to the patterns. */
export const GRADIENT_STYLE = 'gradient';

/** The second color until the kid picks one: white, so the fill fades to paper. */
export const DEFAULT_GRADIENT_END: string = NEUTRAL_COLORS[0];

/** A second color the picker offers (and a saved drawing may carry). */
export const isGradientEnd = (v: unknown): v is string =>
	typeof v === 'string' && PALETTE.includes(v);

/** A usable second color, or white for anything else. */
export const gradientEnd = (v: unknown): string => (isGradientEnd(v) ? v : DEFAULT_GRADIENT_END);

/**
 * Top and bottom edge (y0 inclusive, y1 exclusive) of flat [y, x0, x1] runs, so the gradient fits
 * the region's own bounding box. Null for no runs.
 */
export function spanRange(spans: Uint32Array): { y0: number; y1: number } | null {
	if (spans.length < 3) return null;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (let i = 0; i < spans.length; i += 3) {
		if (spans[i] < y0) y0 = spans[i];
		if (spans[i] > y1) y1 = spans[i];
	}
	return { y0, y1: y1 + 1 };
}

/** Gradient line and stops for a region: from `from` at the top row to `to` below its last row. */
export function gradientStops(
	spans: Uint32Array,
	from: string,
	to: string
): { y0: number; y1: number; stops: [number, string][] } | null {
	const r = spanRange(spans);
	return r
		? {
				...r,
				stops: [
					[0, from],
					[1, gradientEnd(to)]
				]
			}
		: null;
}
