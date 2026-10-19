/**
 * A photo to draw on (hub-cn7.9.2): the board's bottom layer can be a picture from the hub's
 * photo library. The server only renders a few sizes (see photo-fit), so these helpers choose the
 * smallest cached copy that still covers the canvas, and place it centred without cropping.
 * Pure: no canvas, no network.
 */

/** Long sides the photo API serves at display resolution, smallest first (height is 9/16 of it). */
const LONG_SIDES = [1920, 2560, 3840] as const;
/** Thumbnail size for the picker grid. */
export const THUMB = { w: 480, h: 270 } as const;

export interface Size {
	w: number;
	h: number;
}

/** A photo id as the library issues them (uuid-like); anything else is never requested or saved. */
export const isPhotoId = (v: unknown): v is string =>
	typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/**
 * The cached render to fetch for a canvas of `canvas` device pixels: landscape or portrait to
 * match the board, and the smallest served size whose long side covers it (capped at the largest).
 */
export function photoSize(canvas: Size): Size {
	const landscape = canvas.w >= canvas.h;
	const need = Math.max(canvas.w, canvas.h);
	const long = LONG_SIDES.find((s) => s >= need) ?? LONG_SIDES[LONG_SIDES.length - 1];
	const short = (long * 9) / 16;
	return landscape ? { w: long, h: short } : { w: short, h: long };
}

/** URL of a photo at the size the API serves (webp: every browser the hub supports can decode it). */
export function photoUrl(id: string, size: Size): string {
	return `/api/photo/${encodeURIComponent(id)}?w=${size.w}&h=${size.h}&fmt=webp`;
}

/** Thumbnail URL, portrait photos get the portrait render so they are not squeezed. */
export function thumbUrl(id: string, w: number | null, h: number | null): string {
	const portrait = w !== null && h !== null && h > w;
	return photoUrl(id, portrait ? { w: THUMB.h, h: THUMB.w } : { w: THUMB.w, h: THUMB.h });
}

/** Where an image of `image` pixels sits on a canvas of `canvas` pixels: whole picture, centred. */
export function containRect(
	image: Size,
	canvas: Size
): { x: number; y: number; w: number; h: number } {
	if (image.w <= 0 || image.h <= 0) return { x: 0, y: 0, w: canvas.w, h: canvas.h };
	const s = Math.min(canvas.w / image.w, canvas.h / image.h);
	const w = image.w * s;
	const h = image.h * s;
	return { x: (canvas.w - w) / 2, y: (canvas.h - h) / 2, w, h };
}
