/**
 * Space Junk (hub-26w.2): the pure view math behind the canvas. A camera fits the level into any
 * canvas shape, converts between metres (y up) and pixels (y down), and turns a pointer drag on
 * the pouch into a pull. All pixel values are CSS pixels; `renderSize` maps those to the backing
 * store.
 */
import type { Level, Point } from './level.js';
import { MIN_PULL, clampPull } from './pull.js';

/** Empty metres kept around the level so towers never touch the canvas edge. */
export const VIEW_MARGIN = 1;
/** How far from the pouch (CSS px) a drag may start; big enough for a small finger. */
export const GRAB_RADIUS_PX = 96;
/** The widest backing store drawn each frame; CSS scales it up to the real screen. */
export const MAX_RENDER_WIDTH = 1920;

export interface Camera {
	/** CSS pixels per metre. */
	scale: number;
	/** Screen x of world x = 0. */
	ox: number;
	/** Screen y of the ground (world y = 0). */
	oy: number;
}

/** Fits the whole level (plus margin) into the canvas: centred sideways, ground at the bottom. */
export function fitCamera(
	level: Pick<Level, 'width' | 'height'>,
	cssW: number,
	cssH: number
): Camera {
	const w = Math.max(1, cssW);
	const h = Math.max(1, cssH);
	const scale = Math.min(w / (level.width + 2 * VIEW_MARGIN), h / (level.height + 2 * VIEW_MARGIN));
	return { scale, ox: (w - level.width * scale) / 2, oy: h - VIEW_MARGIN * scale };
}

export const toScreen = (cam: Camera, p: Point): Point => ({
	x: cam.ox + p.x * cam.scale,
	y: cam.oy - p.y * cam.scale
});

export const toWorld = (cam: Camera, p: Point): Point => ({
	x: (p.x - cam.ox) / cam.scale,
	y: (cam.oy - p.y) / cam.scale
});

/** True when a pointer at `pointer` (screen px) is close enough to the pouch to grab it. */
export function canGrab(
	cam: Camera,
	pouch: Point,
	pointer: Point,
	radiusPx = GRAB_RADIUS_PX
): boolean {
	const s = toScreen(cam, pouch);
	return Math.hypot(pointer.x - s.x, pointer.y - s.y) <= radiusPx;
}

/** The pull (pouch minus anchor, metres) for a pointer position, clamped to the band's reach. */
export function pullFromPointer(cam: Camera, anchor: Point, pointer: Point): Point {
	const w = toWorld(cam, pointer);
	return clampPull({ x: w.x - anchor.x, y: w.y - anchor.y });
}

/** The pull to launch with on release, or null when it is too short and the shot is cancelled. */
export function releasePull(pull: Point): Point | null {
	return Math.hypot(pull.x, pull.y) < MIN_PULL ? null : pull;
}

export interface RenderSize {
	/** Backing store size in device pixels. */
	width: number;
	height: number;
	/** Backing pixels per CSS pixel; apply as the context's base transform. */
	ratio: number;
}

/** Backing store for a canvas: device-pixel sharp, but never wider than `maxWidth`. */
export function renderSize(
	cssW: number,
	cssH: number,
	dpr: number,
	maxWidth = MAX_RENDER_WIDTH
): RenderSize {
	const w = Math.max(1, cssW);
	const want = Math.max(1, dpr);
	const ratio = Math.min(want, maxWidth / w);
	return {
		width: Math.max(1, Math.round(w * ratio)),
		height: Math.max(1, Math.round(cssH * ratio)),
		ratio
	};
}
