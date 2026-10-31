/**
 * Shape snapping (hub-cn7.21): turns a rough pen stroke into the clean shape it was meant to be.
 * Pure geometry, no canvas. Deliberately conservative: a wrong snap ruins a drawing, a missed
 * snap costs nothing, so anything ambiguous (scribbles, letters, spirals, zig-zags, taps) is null.
 *
 * Recognised, all axis-aligned (like the shape tools): circle, oval, square (also drawn as a
 * rectangle: the box is kept), triangle (apex up), straight line and arrow (shaft with a head at
 * the end of the stroke).
 *
 * Default is OFF (see SNAP_STORAGE_KEY note in the sheet): children draw freely and a snap should
 * be something they chose. Every snap is reversible by Keep my line and by Undo.
 */
import type { DrawPoint, Shape, Stroke } from './drawing.js';

/** Snaps below this confidence (0..1) are dropped. */
export const SNAP_MIN_CONFIDENCE = 0.55;
/** Shortest stroke (px of path) that can be a shape: shorter ones are taps and dots. */
export const SNAP_MIN_LENGTH = 90;
/** Equal-looking sides (within this ratio) become a perfect square or circle. */
const ROUND_ASPECT = 0.85;
const SAMPLES = 72;

export interface Snap {
	shape: Shape;
	confidence: number;
}
interface Pt {
	x: number;
	y: number;
}
interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const pathLength = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + dist(pts[i - 1], p) : 0), 0);

function boxOf(pts: Pt[]): Box {
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** `n` points evenly spaced along the path, so jitter and speed do not matter. */
function resample(pts: Pt[], n: number): Pt[] {
	const total = pathLength(pts);
	const step = total / (n - 1);
	const out: Pt[] = [pts[0]];
	let carried = 0;
	for (let i = 1; i < pts.length && out.length < n; i++) {
		let a = pts[i - 1];
		const b = pts[i];
		let seg = dist(a, b);
		while (carried + seg >= step && out.length < n) {
			const t = (step - carried) / seg;
			a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			out.push(a);
			seg = dist(a, b);
			carried = 0;
		}
		carried += seg;
	}
	while (out.length < n) out.push(pts[pts.length - 1]);
	return out;
}

/**
 * Signed and absolute turning (radians) along a resampled path, measured over a short span so
 * noise cancels. A clean loop turns about one full circle and never reverses; scribbles and
 * letters reverse (absolute much larger than signed); spirals turn two or more circles.
 */
function turning(pts: Pt[], span = 4): { signed: number; abs: number } {
	let signed = 0;
	let abs = 0;
	for (let i = span; i + span < pts.length; i++) {
		const a = Math.atan2(pts[i].y - pts[i - span].y, pts[i].x - pts[i - span].x);
		const b = Math.atan2(pts[i + span].y - pts[i].y, pts[i + span].x - pts[i].x);
		let d = b - a;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		signed += d;
		abs += Math.abs(d);
	}
	return { signed: signed / span, abs: abs / span };
}

const outlineError = (pts: Pt[], poly: Pt[]): { mean: number; max: number } => {
	let sum = 0;
	let max = 0;
	for (const p of pts) {
		let d = Infinity;
		for (let i = 0; i < poly.length; i++)
			d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));
		sum += d;
		max = Math.max(max, d);
	}
	return { mean: sum / pts.length, max };
};

function ellipseError(pts: Pt[], b: Box): { mean: number; max: number } {
	const cx = b.x + b.w / 2;
	const cy = b.y + b.h / 2;
	const a = b.w / 2;
	const c = b.h / 2;
	let sum = 0;
	let max = 0;
	for (const p of pts) {
		const u = p.x - cx;
		const v = p.y - cy;
		const r = Math.hypot(u / a, v / c) || 1e-6;
		const g = Math.hypot(u / (a * a * r), v / (c * c * r)) || 1e-6;
		const d = Math.abs(r - 1) / g;
		sum += d;
		max = Math.max(max, d);
	}
	return { mean: sum / pts.length, max };
}

/** 1 at a perfect fit, 0 at the tolerance. Mean error is judged tightly, worst point loosely. */
const fitScore = (e: { mean: number; max: number }, scale: number): number =>
	Math.min(1 - e.mean / (0.05 * scale), 1 - e.max / (0.13 * scale));

function recognizeLine(
	pts: Pt[],
	len: number
): { shape: 'line' | 'arrow'; a: Pt; b: Pt; conf: number } | null {
	const start = pts[0];
	// The tip is the point farthest from the start; an arrow head hooks back from it.
	let far = 0;
	for (const p of pts) far = Math.max(far, dist(start, p));
	if (far < SNAP_MIN_LENGTH * 0.7) return null;
	// The first time the stroke gets (nearly) that far is the tip; a hook may come back to it.
	let tipAt = pts.findIndex((p) => dist(start, p) >= 0.97 * far);
	if (pathLength(pts.slice(tipAt)) < 0.08 * far) tipAt = pts.length - 1; // no hook: a plain line
	const tip = pts[tipAt];
	const shaft = pts.slice(0, tipAt + 1);
	const tail = pts.slice(tipAt);
	const dev = (path: Pt[]) => Math.max(...path.map((p) => segDist(p, start, tip)));
	if (tipAt === pts.length - 1) {
		if (pathLength(shaft) / far > 1.12 || dev(shaft) > 0.07 * far) return null;
		return { shape: 'line', a: start, b: tip, conf: 1 - dev(shaft) / (0.07 * far) };
	}
	// Arrow: a straight shaft, then a head of up to two short strokes hooking back at the tip.
	const shaftLen = pathLength(shaft);
	if (shaftLen / far > 1.12 || dev(shaft) > 0.07 * far) return null;
	const tailLen = pathLength(tail);
	if (tailLen < 0.2 * far || tailLen > 1.1 * far || len < far) return null;
	const ux = (start.x - tip.x) / far;
	const uy = (start.y - tip.y) / far;
	// Two barbs: out to one side, back through the tip, out to the other side.
	const lean = (p: Pt) => (p.x - tip.x) * -uy + (p.y - tip.y) * ux; // signed offset from the shaft
	for (const p of tail) {
		const back = (p.x - tip.x) * ux + (p.y - tip.y) * uy; // distance back along the shaft
		if (back < -0.05 * far || back > 0.5 * far || Math.abs(lean(p)) > 0.4 * far) return null;
	}
	const flare = 0.1 * far;
	const first = tail.findIndex((p) => Math.abs(lean(p)) >= flare);
	const hub = first < 0 ? -1 : tail.findIndex((p, i) => i > first && dist(p, tip) < 0.12 * far);
	const second = hub < 0 ? -1 : tail.findIndex((p, i) => i > hub && Math.abs(lean(p)) >= flare);
	if (second < 0 || lean(tail[first]) * lean(tail[second]) > 0) return null;
	return { shape: 'arrow', a: start, b: tip, conf: 0.7 };
}

const meanWidth = (pts: readonly DrawPoint[]) => pts.reduce((n, p) => n + p.w, 0) / pts.length;

/**
 * The clean shape this stroke was meant to be, or null. `points` are CSS px; the result shape has
 * the stroke's colour and average width and sits where the stroke was drawn.
 */
export function recognizeShape(
	points: readonly DrawPoint[],
	color: string,
	minConfidence = SNAP_MIN_CONFIDENCE
): Snap | null {
	if (points.length < 6) return null;
	const raw = points.map((p) => ({ x: p.x, y: p.y }));
	const len = pathLength(raw);
	if (!(len >= SNAP_MIN_LENGTH)) return null;
	const width = Math.max(2, meanWidth(points));
	const done = (s: Omit<Shape, 'color' | 'filled' | 'width'>, confidence: number): Snap | null =>
		confidence >= minConfidence
			? { shape: { ...s, color, filled: false, width }, confidence: Math.min(1, confidence) }
			: null;

	const pts = resample(raw, SAMPLES);
	const open = dist(raw[0], raw[raw.length - 1]) > 0.25 * len;
	if (open) {
		const l = recognizeLine(pts, len);
		return l ? done({ shape: l.shape, x0: l.a.x, y0: l.a.y, x1: l.b.x, y1: l.b.y }, l.conf) : null;
	}

	// Closed loops: one clean turn, no reversing, not a spiral, not a squashed line.
	const turn = turning(pts);
	if (Math.abs(turn.signed) < 1.35 * Math.PI || Math.abs(turn.signed) > 2.6 * Math.PI) return null;
	if (turn.abs > Math.abs(turn.signed) * 1.3) return null;
	const b = boxOf(pts);
	if (Math.min(b.w, b.h) < 28 || Math.min(b.w, b.h) < 0.18 * Math.max(b.w, b.h)) return null;
	const scale = (b.w + b.h) / 2;
	const loop = [...pts, pts[0]]; // close the loop for the outline fits

	const rect = [
		{ x: b.x, y: b.y },
		{ x: b.x + b.w, y: b.y },
		{ x: b.x + b.w, y: b.y + b.h },
		{ x: b.x, y: b.y + b.h }
	];
	const tri = [
		{ x: b.x + b.w / 2, y: b.y },
		{ x: b.x + b.w, y: b.y + b.h },
		{ x: b.x, y: b.y + b.h }
	];
	const fits = [
		{ kind: 'ellipse', score: fitScore(ellipseError(loop, b), scale) },
		{ kind: 'rect', score: fitScore(outlineError(loop, rect), scale) },
		{ kind: 'tri', score: fitScore(outlineError(loop, tri), scale) }
	].sort((p, q) => q.score - p.score);
	const [best, next] = fits;
	// Ambiguous between two shapes: leave the child's line alone.
	if (best.score - next.score < 0.2 && next.score > 0) return null;

	const roundish = Math.min(b.w, b.h) / Math.max(b.w, b.h) >= ROUND_ASPECT;
	const cx = b.x + b.w / 2;
	const cy = b.y + b.h / 2;
	const side = (b.w + b.h) / 2;
	const box = roundish
		? { x0: cx - side / 2, y0: cy - side / 2, x1: cx + side / 2, y1: cy + side / 2 }
		: { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
	if (best.kind === 'ellipse')
		return done({ shape: roundish ? 'circle' : 'oval', ...box }, best.score);
	if (best.kind === 'rect') return done({ shape: 'square', ...box }, best.score);
	return done({ shape: 'triangle', x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }, best.score);
}

/** Why a stroke can never snap: only plain, solid, unmirrored pen ink does. */
export function isSnappable(stroke: Stroke): boolean {
	if (stroke.tool !== 'pen' || stroke.mirror) return false;
	return stroke.alpha === undefined || stroke.alpha >= 1;
}

/** The snapped shape for a finished stroke, or null when it is not snappable or not a clean shape. */
export function snapStroke(stroke: Stroke): Shape | null {
	if (!isSnappable(stroke)) return null;
	return recognizeShape(stroke.points, stroke.color)?.shape ?? null;
}

/** How long the Keep my line chip stays after a snap. */
export const KEEP_CHIP_MS = 4000;

/**
 * Snap is remembered per device (localStorage), and defaults to OFF: kids draw freely, and a
 * line that changes under the finger is a surprise they should opt in to. Storage can be missing
 * or throw (private windows, blocked site data), so both calls fail quietly to the default.
 */
export const SNAP_STORAGE_KEY = 'hub.drawing.snap';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | null => {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
};
export function loadSnapPref(store: Store | null = browserStore()): boolean {
	try {
		return store?.getItem(SNAP_STORAGE_KEY) === 'on';
	} catch {
		return false;
	}
}
export function saveSnapPref(on: boolean, store: Store | null = browserStore()): void {
	try {
		store?.setItem(SNAP_STORAGE_KEY, on ? 'on' : 'off');
	} catch {
		// Not remembered; the toggle still works for this visit.
	}
}
