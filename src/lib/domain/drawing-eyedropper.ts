/**
 * Eyedropper (hub-cn7.14): the color under the finger, as the kid sees it. The board is several
 * canvases stacked over a background, so the pick composites one pixel from each visible layer
 * (bottom first) with the normal "over" rule. Pure: callers hand in RGBA arrays read from canvases.
 */

/** One pixel: red, green, blue, alpha, each 0-255 (the layout of canvas ImageData). */
export type Rgba = readonly [number, number, number, number];

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

const byte = (n: number) => Math.min(255, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/** `layers` are bottom to top, painted over an opaque `background`; hidden layers are left out. */
export function compositePixel(background: Rgba, layers: readonly Rgba[]): Rgb {
	let r = byte(background[0]);
	let g = byte(background[1]);
	let b = byte(background[2]);
	for (const [lr, lg, lb, la] of layers) {
		const a = byte(la) / 255;
		if (a <= 0) continue;
		r = r * (1 - a) + byte(lr) * a;
		g = g * (1 - a) + byte(lg) * a;
		b = b * (1 - a) + byte(lb) * a;
	}
	return { r: byte(r), g: byte(g), b: byte(b) };
}

/** A CSS color string a stroke can carry (short, so the saved-drawing validator keeps it). */
export const rgbCss = ({ r, g, b }: Rgb): string => `rgb(${byte(r)} ${byte(g)} ${byte(b)})`;

/** Device pixel under a pointer, clamped onto the canvas (a drag may leave the board). */
export function pixelAt(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
	canvas: { width: number; height: number }
): { x: number; y: number } {
	const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
	const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
	const clamp = (f: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(f * n)));
	return { x: clamp(fx, canvas.width), y: clamp(fy, canvas.height) };
}
