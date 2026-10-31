/**
 * Kids' drawings in the idle photo frame (hub-cn7.28): settings values, the card shape and where
 * drawings fall among the photos. Pure so the frame component only wires timers and images.
 *
 * Replay hook (hub-cn7.22): a card carries `src` for the still; a replay would add an optional
 * field here and render it where Slideshow.svelte shows `slot.card`.
 */
import type { SlidePhoto } from './slideshow.js';

export const DRAWING_MODES = ['off', 'on'] as const;
export type DrawingMode = (typeof DRAWING_MODES)[number];

export function isDrawingMode(v: unknown): v is DrawingMode {
	return typeof v === 'string' && (DRAWING_MODES as readonly string[]).includes(v);
}

/** One drawing per this many photos. */
export const DRAWING_EVERY = 5;

/** A posted drawing as /api/photo/drawings serves it. */
export interface FrameDrawing {
	id: string;
	/** The artist's first name. */
	name: string;
	/** URL of the PNG, served by this server. */
	src: string;
}

/** Playlist ids for drawings start with this, so photo actions (hide) can tell them apart. */
export const DRAWING_ID_PREFIX = 'drawing:';

export const isDrawingId = (id: string) => id.startsWith(DRAWING_ID_PREFIX);

/** The first word of a member's name ("Ada Lovelace" shows as "Ada"). */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? '';
}

/** A drawing as a playlist entry; the frame reads `drawing` instead of asking for a photo. */
export function drawingEntry(d: FrameDrawing): SlidePhoto {
	return { id: DRAWING_ID_PREFIX + d.id, w: null, h: null, drawing: { name: d.name, src: d.src } };
}

/**
 * The photos with one drawing after every `every` photos, taken in the order given (the caller
 * shuffles). A short pass still gets one drawing at its end. Each drawing appears once per pass;
 * with no photos, the drawings play alone.
 */
export function interleaveDrawings(
	photos: readonly SlidePhoto[],
	drawings: readonly FrameDrawing[],
	every = DRAWING_EVERY
): SlidePhoto[] {
	const cards = drawings.map(drawingEntry);
	if (cards.length === 0) return [...photos];
	const gap = Math.max(1, Math.floor(every));
	const out: SlidePhoto[] = [];
	let used = 0;
	photos.forEach((photo, i) => {
		out.push(photo);
		if ((i + 1) % gap === 0 && used < cards.length) out.push(cards[used++]);
	});
	if (used === 0) out.push(cards[used++]);
	return out;
}
