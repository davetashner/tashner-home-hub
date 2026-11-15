/**
 * Lasso (hub-t27j.6): circle some freehand ink to select it, then move, resize or copy it.
 *
 * Only freehand ink is selectable (pen, highlighter and the textured brushes). Shapes, fills and
 * text have their own edit flow, and the eraser is a cut, not ink. A stroke is inside the loop
 * when more than half of its points are. Every transform returns NEW strokes (the originals are
 * left alone), so the sheet can keep the originals as the undo "before". Pure: no canvas, no DOM.
 */
import type { DrawItem, Stroke } from './drawing.js';

export interface Pt {
	x: number;
	y: number;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const MIN_LOOP_POINTS = 3;
export const MIN_LOOP_AREA = 400;
export const INSIDE_SHARE = 0.5;
export const BOX_PAD = 16;
export const MIN_SIDE = 48;
export const MAX_SCALE = 8;
export const COPY_OFFSET: Pt = { x: 48, y: 48 };

/** Freehand ink the lasso can pick up. */
export const isLassoInk = (item: DrawItem): item is Stroke =>
	'points' in item && Array.isArray(item.points) && item.tool !== 'eraser';

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
			inside = !inside;
	}
	return inside;
}

/** Absolute area of a polygon (shoelace). */
export function polygonArea(poly: readonly Pt[]): number {
	let sum = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
		sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
	return Math.abs(sum) / 2;
}

/** True when a drawn path is a real loop and not a tap or a straight scribble. */
export const isLoop = (poly: readonly Pt[]): boolean =>
	poly.length >= MIN_LOOP_POINTS && polygonArea(poly) >= MIN_LOOP_AREA;

/** Indices (into `items`) of the strokes the loop encloses. Empty for a malformed loop. */
export function selectInside(items: readonly DrawItem[], loop: readonly Pt[]): number[] {
	if (!isLoop(loop)) return [];
	const out: number[] = [];
	items.forEach((item, i) => {
		if (!isLassoInk(item) || item.points.length === 0) return;
		let inside = 0;
		for (const p of item.points) if (pointInPolygon(p, loop)) inside++;
		if (inside / item.points.length > INSIDE_SHARE) out.push(i);
	});
	return out;
}

/** The strokes the loop encloses, in board order: the selection later features build on. */
export const lassoSelection = (items: readonly DrawItem[], loop: readonly Pt[]): Stroke[] =>
	selectInside(items, loop).map((i) => items[i] as Stroke);

/** Box around the points of these strokes (padded by half their widest line), or null if empty. */
export function inkBounds(strokes: readonly Stroke[]): Box | null {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const s of strokes)
		for (const p of s.points) {
			const r = (Number.isFinite(p.w) ? p.w : 0) / 2;
			x0 = Math.min(x0, p.x - r);
			y0 = Math.min(y0, p.y - r);
			x1 = Math.max(x1, p.x + r);
			y1 = Math.max(y1, p.y + r);
		}
	return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The dashed selection frame: the ink bounds with some air around them. */
export const frameOf = (b: Box, pad = BOX_PAD): Box => ({
	x: b.x - pad,
	y: b.y - pad,
	w: b.w + pad * 2,
	h: b.h + pad * 2
});

export const inBox = (p: Pt, b: Box, slop = 0): boolean =>
	p.x >= b.x - slop && p.x <= b.x + b.w + slop && p.y >= b.y - slop && p.y <= b.y + b.h + slop;

/** The resize handle sits on the frame's bottom-right corner. */
export const resizeHandle = (frame: Box): Pt => ({ x: frame.x + frame.w, y: frame.y + frame.h });

/** A scale about `anchor`, then a shift: p -> anchor + (p - anchor) * scale + shift. */
export interface Transform {
	scale: number;
	anchor: Pt;
	dx: number;
	dy: number;
}

export const moveBy = (dx: number, dy: number): Transform => ({
	scale: 1,
	anchor: { x: 0, y: 0 },
	dx,
	dy
});

/**
 * Drag the resize handle to `p`: the frame's top-left stays put and the ink grows or shrinks
 * uniformly with the finger. Clamped so it can neither vanish nor swallow the board.
 */
export function resizeTo(frame: Box, p: Pt, pad = BOX_PAD): Transform {
	// The ink's own box is the frame without its padding; the handle sits `pad` outside its corner.
	const ink = { x: frame.x + pad, y: frame.y + pad, w: frame.w - pad * 2, h: frame.h - pad * 2 };
	const anchor = { x: ink.x, y: ink.y };
	const diag2 = ink.w * ink.w + ink.h * ink.h || 1;
	// Project the finger onto the ink's diagonal so both axes scale together.
	const along = ((p.x - pad - anchor.x) * ink.w + (p.y - pad - anchor.y) * ink.h) / diag2;
	const min = Math.min(1, MIN_SIDE / Math.max(Math.min(ink.w, ink.h), 1));
	const scale = Math.min(MAX_SCALE, Math.max(min, Number.isFinite(along) ? along : 1));
	return { scale, anchor, dx: 0, dy: 0 };
}

const at = (p: Pt, t: Transform): Pt => ({
	x: t.anchor.x + (p.x - t.anchor.x) * t.scale + t.dx,
	y: t.anchor.y + (p.y - t.anchor.y) * t.scale + t.dy
});

/** A copy of the stroke with the transform applied (points, line widths, mirror centre). */
export function transformStroke(s: Stroke, t: Transform): Stroke {
	const out: Stroke = {
		...s,
		points: s.points.map((p) => ({ ...p, ...at(p, t), w: p.w * t.scale }))
	};
	if (s.mirror)
		out.mirror = {
			...s.mirror,
			...(({ x, y }) => ({ cx: x, cy: y }))(at({ x: s.mirror.cx, y: s.mirror.cy }, t))
		};
	return out;
}

export const transformStrokes = (strokes: readonly Stroke[], t: Transform): Stroke[] =>
	strokes.map((s) => transformStroke(s, t));

/** Duplicates of the strokes, shifted a little so the copy is plainly a copy. */
export const copyStrokes = (strokes: readonly Stroke[], offset: Pt = COPY_OFFSET): Stroke[] =>
	transformStrokes(strokes, moveBy(offset.x, offset.y));

/** Keep a copy's offset on the board: step back the other way when it would run off the edge. */
export function copyOffset(
	frame: Box,
	board: { w: number; h: number },
	step: Pt = COPY_OFFSET
): Pt {
	return {
		x: frame.x + frame.w + step.x > board.w ? -step.x : step.x,
		y: frame.y + frame.h + step.y > board.h ? -step.y : step.y
	};
}
