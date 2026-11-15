/**
 * Protractor (hub-t27j.24): a half-circle overlay the kids move and turn on the board. A stroke that
 * starts near its center and is pulled away becomes a dead-straight line from the center at the nearest
 * 15 degrees. Like the ruler it is never ink: not a stroke, never saved, never posted. Pure: no DOM.
 *
 * Geometry is in board CSS px. `angle` (radians) is the direction the flat (0 degree) side points;
 * the half-circle bulges to the left of that direction in screen terms (so at angle 0 it opens upward).
 */
import { normalizeAngle, type Pt, type Size } from './drawing-ruler.js';

export interface Protractor {
	cx: number;
	cy: number;
	angle: number;
	r: number;
}

export const PROTRACTOR_RADIUS = 480;
export const SNAP_STEP_DEG = 15;
/** How close (board px at zoom 1) to the center a stroke must start to be snapped. */
export const CENTER_SNAP_DISTANCE = 96;
/** How far the pen must move from the center before the direction is decided. */
export const AIM_DISTANCE = 24;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const DEG = Math.PI / 180;

export function defaultProtractor(size: Size): Protractor {
	const w = finite(size.w) && size.w > 0 ? size.w : 2 * PROTRACTOR_RADIUS;
	const h = finite(size.h) && size.h > 0 ? size.h : 2 * PROTRACTOR_RADIUS;
	const r = Math.min(PROTRACTOR_RADIUS, w * 0.4, h * 0.6);
	return { cx: w / 2, cy: h * 0.6, angle: 0, r };
}

/** Keep the center on the board and the numbers sane, so it can never be lost. */
export function clampProtractor(p: Protractor, size: Size): Protractor {
	const w = Math.max(0, finite(size.w) ? size.w : 0);
	const h = Math.max(0, finite(size.h) ? size.h : 0);
	return {
		...p,
		cx: Math.min(w, Math.max(0, finite(p.cx) ? p.cx : w / 2)),
		cy: Math.min(h, Math.max(0, finite(p.cy) ? p.cy : h / 2)),
		angle: finite(p.angle) ? normalizeAngle(p.angle) : 0
	};
}

export const moveProtractor = (p: Protractor, dx: number, dy: number): Protractor => ({
	...p,
	cx: p.cx + (finite(dx) ? dx : 0),
	cy: p.cy + (finite(dy) ? dy : 0)
});

export const rotateProtractor = (p: Protractor, delta: number): Protractor => ({
	...p,
	angle: normalizeAngle(p.angle + (finite(delta) ? delta : 0))
});

/** Turn the protractor so its 0 degree side points from its center at the point (the turn handle). */
export function aimProtractor(p: Protractor, at: Pt): Protractor {
	const dx = at.x - p.cx;
	const dy = at.y - p.cy;
	if (!finite(dx) || !finite(dy) || (dx === 0 && dy === 0)) return p;
	return { ...p, angle: Math.atan2(dy, dx) };
}

/** True when `pt` is within `tol` of the center. */
export function nearCenter(p: Protractor, pt: Pt, tol: number = CENTER_SNAP_DISTANCE): boolean {
	if (!finite(pt.x) || !finite(pt.y)) return false;
	return Math.hypot(pt.x - p.cx, pt.y - p.cy) <= tol;
}

/** `raw` (radians) rounded to the nearest multiple of `stepDeg` degrees, counted from `base`. */
export function snapAngle(raw: number, stepDeg: number = SNAP_STEP_DEG, base = 0): number {
	if (!finite(raw)) return normalizeAngle(base);
	const step = (finite(stepDeg) && stepDeg > 0 ? stepDeg : SNAP_STEP_DEG) * DEG;
	const b = finite(base) ? base : 0;
	return normalizeAngle(b + Math.round((raw - b) / step) * step);
}

/**
 * The direction (radians) a stroke from the center takes once the pen is `AIM_DISTANCE` away from it,
 * snapped to the protractor's 15 degree marks; null while it is still too close to tell.
 */
export function aimAngle(p: Protractor, at: Pt, minDistance: number = AIM_DISTANCE): number | null {
	const dx = at.x - p.cx;
	const dy = at.y - p.cy;
	if (!finite(dx) || !finite(dy) || Math.hypot(dx, dy) < minDistance) return null;
	return snapAngle(Math.atan2(dy, dx), SNAP_STEP_DEG, p.angle);
}

/** `pt` projected on the ray from the center at `angle` (never behind the center). */
export function pointOnRay(p: Protractor, angle: number, pt: Pt): Pt {
	const ux = Math.cos(angle);
	const uy = Math.sin(angle);
	const t = Math.max(0, (pt.x - p.cx) * ux + (pt.y - p.cy) * uy);
	return { x: p.cx + ux * t, y: p.cy + uy * t };
}

export interface Mark {
	deg: number;
	label: boolean;
}

/** The degree marks around the half-circle: 0..180 every 5, labelled every 15. */
export function protractorMarks(): Mark[] {
	return Array.from({ length: 37 }, (_, i) => ({
		deg: i * 5,
		label: (i * 5) % SNAP_STEP_DEG === 0
	}));
}
