/**
 * Editing a just-placed shape (hub-cn7.5): where its handles sit, and how a drag moves, resizes
 * or rotates it. A shape turns about the centre of its box (`rot`); lines bake the turn into
 * their two ends instead, so a line's handles are simply its ends. Pure: no canvas, no DOM.
 */
import { isLineShape, shapeBounds, type Shape } from './drawing.js';

export interface Pt {
	x: number;
	y: number;
}

/** Touch area of every handle; the visible dot may be smaller. */
export const HANDLE_HIT = 96;
/** A shape cannot be squeezed below this many CSS px. */
export const SHAPE_MIN_SIZE = 24;
/** How far the rotate handle floats beyond the shape's edge. */
export const ROTATE_GAP = 72;
/** Slack around the shape in which a touch still grabs it (fingers are not precise). */
export const GRAB_SLOP = 24;

export const rotationOf = (s: Pick<Shape, 'rot'>): number => s.rot ?? 0;

export const shapeCenter = (s: Pick<Shape, 'x0' | 'y0' | 'x1' | 'y1'>): Pt => ({
	x: (s.x0 + s.x1) / 2,
	y: (s.y0 + s.y1) / 2
});

export function rotatePoint(p: Pt, about: Pt, angle: number): Pt {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dx = p.x - about.x;
	const dy = p.y - about.y;
	return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

/** Wrap an angle to (-PI, PI]. */
export function normAngle(a: number): number {
	const t = a % (2 * Math.PI);
	if (t > Math.PI) return t - 2 * Math.PI;
	if (t <= -Math.PI) return t + 2 * Math.PI;
	return t;
}

/** True when a point lands on the shape's (turned) box, with slack for fingers. */
export function hitBody(s: Shape, p: Pt, slop = Math.max(s.width + 8, GRAB_SLOP)): boolean {
	const q = rotatePoint(p, shapeCenter(s), -rotationOf(s));
	const b = shapeBounds(s);
	return (
		q.x >= b.x - slop && q.x <= b.x + b.w + slop && q.y >= b.y - slop && q.y <= b.y + b.h + slop
	);
}

/** Where the resize and rotate handles sit, in canvas pixels. */
export function handlePoints(s: Shape): { resize: Pt; rotate: Pt } {
	if (isLineShape(s.shape)) {
		const dx = s.x1 - s.x0;
		const dy = s.y1 - s.y0;
		const len = Math.hypot(dx, dy);
		const c = shapeCenter(s);
		// Perpendicular to the line, so the handle never sits on top of an end.
		const ux = len === 0 ? 0 : -dy / len;
		const uy = len === 0 ? -1 : dx / len;
		return {
			resize: { x: s.x1, y: s.y1 },
			rotate: { x: c.x + ux * ROTATE_GAP, y: c.y + uy * ROTATE_GAP }
		};
	}
	const b = shapeBounds(s);
	const c = shapeCenter(s);
	const r = rotationOf(s);
	return {
		resize: rotatePoint({ x: b.x + b.w, y: b.y + b.h }, c, r),
		rotate: rotatePoint({ x: c.x, y: b.y - ROTATE_GAP }, c, r)
	};
}

/** The four corners of the selection frame (the turned box, padded), in order. */
export function selectionCorners(s: Shape): Pt[] {
	const pad = s.width / 2 + 6;
	const b = shapeBounds(s);
	const c = shapeCenter(s);
	const r = rotationOf(s);
	return [
		{ x: b.x - pad, y: b.y - pad },
		{ x: b.x + b.w + pad, y: b.y - pad },
		{ x: b.x + b.w + pad, y: b.y + b.h + pad },
		{ x: b.x - pad, y: b.y + b.h + pad }
	].map((p) => rotatePoint(p, c, r));
}

/** Keep a handle reachable when its shape sits at the edge of the board. */
export const clampPoint = (p: Pt, w: number, h: number, margin = HANDLE_HIT / 2): Pt => ({
	x: Math.min(Math.max(p.x, Math.min(margin, w / 2)), Math.max(w - margin, w / 2)),
	y: Math.min(Math.max(p.y, Math.min(margin, h / 2)), Math.max(h - margin, h / 2))
});

export const moveShape = (s: Shape, dx: number, dy: number): Shape => ({
	...s,
	x0: s.x0 + dx,
	y0: s.y0 + dy,
	x1: s.x1 + dx,
	y1: s.y1 + dy
});

/**
 * Drag the resize handle to `p`. The opposite corner stays where it is on the board, so the
 * shape grows and shrinks under the finger even when turned. A line's far end follows `p`.
 */
export function resizeShape(s: Shape, p: Pt): Shape {
	if (isLineShape(s.shape)) {
		const dx = p.x - s.x0;
		const dy = p.y - s.y0;
		const len = Math.hypot(dx, dy);
		if (len >= SHAPE_MIN_SIZE) return { ...s, x1: p.x, y1: p.y };
		const ux = len === 0 ? 1 : dx / len;
		const uy = len === 0 ? 0 : dy / len;
		return { ...s, x1: s.x0 + ux * SHAPE_MIN_SIZE, y1: s.y0 + uy * SHAPE_MIN_SIZE };
	}
	const r = rotationOf(s);
	const b = shapeBounds(s);
	const anchor = rotatePoint({ x: b.x, y: b.y }, shapeCenter(s), r);
	const d = rotatePoint({ x: p.x - anchor.x, y: p.y - anchor.y }, { x: 0, y: 0 }, -r);
	const w = Math.max(SHAPE_MIN_SIZE, d.x);
	const h = Math.max(SHAPE_MIN_SIZE, d.y);
	const mid = rotatePoint({ x: w / 2, y: h / 2 }, { x: 0, y: 0 }, r);
	const cx = anchor.x + mid.x;
	const cy = anchor.y + mid.y;
	return { ...s, x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

/** Turn the shape by the angle the pointer swept about its centre, from `from` to `to`. */
export function rotateShape(s: Shape, from: Pt, to: Pt): Shape {
	const c = shapeCenter(s);
	const delta = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x);
	if (isLineShape(s.shape)) {
		const a = rotatePoint({ x: s.x0, y: s.y0 }, c, delta);
		const z = rotatePoint({ x: s.x1, y: s.y1 }, c, delta);
		return { ...s, x0: a.x, y0: a.y, x1: z.x, y1: z.y };
	}
	return { ...s, rot: normAngle(rotationOf(s) + delta) };
}
