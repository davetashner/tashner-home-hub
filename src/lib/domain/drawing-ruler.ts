/**
 * Ruler (hub-t27j.16): a translucent overlay the kids move and turn on the board. A freehand stroke
 * that starts near one of its long edges is projected onto that edge, so it comes out dead straight.
 * The ruler is never ink: it is not a stroke, never saved, never posted. Pure: no canvas, no DOM.
 *
 * Geometry is in board CSS px. `angle` is in radians (0 = lying flat, long side horizontal).
 */
export type Pt = { x: number; y: number };
export type Size = { w: number; h: number };

export interface Ruler {
	cx: number;
	cy: number;
	angle: number;
	len: number;
	thick: number;
}

export interface Edge {
	a: Pt;
	b: Pt;
}

export const RULER_LEN = 1200;
export const RULER_THICK = 160;
/** How close (board px at zoom 1) a stroke must start to the edge to be pulled onto it. */
export const SNAP_DISTANCE = 56;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A ruler that fits the board (never longer than 80% of its width), centered. */
export function defaultRuler(size: Size): Ruler {
	const w = finite(size.w) && size.w > 0 ? size.w : RULER_LEN;
	const h = finite(size.h) && size.h > 0 ? size.h : RULER_LEN;
	return { cx: w / 2, cy: h / 2, angle: 0, len: Math.min(RULER_LEN, w * 0.8), thick: RULER_THICK };
}

/** Keep the center on the board and the numbers sane, so the ruler can never be lost. */
export function clampRuler(r: Ruler, size: Size): Ruler {
	const w = Math.max(0, finite(size.w) ? size.w : 0);
	const h = Math.max(0, finite(size.h) ? size.h : 0);
	return {
		...r,
		cx: Math.min(w, Math.max(0, finite(r.cx) ? r.cx : w / 2)),
		cy: Math.min(h, Math.max(0, finite(r.cy) ? r.cy : h / 2)),
		angle: finite(r.angle) ? normalizeAngle(r.angle) : 0
	};
}

/** An angle in (-PI, PI]. */
export function normalizeAngle(a: number): number {
	if (!finite(a)) return 0;
	const t = ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
	return t === -Math.PI ? Math.PI : t;
}

/** The two long edges: one on each side of the center line, same direction. */
export function rulerEdges(r: Ruler): [Edge, Edge] {
	const ux = Math.cos(r.angle);
	const uy = Math.sin(r.angle);
	const nx = -uy;
	const ny = ux;
	const hl = r.len / 2;
	const ht = r.thick / 2;
	const edge = (s: number): Edge => ({
		a: { x: r.cx - ux * hl + nx * ht * s, y: r.cy - uy * hl + ny * ht * s },
		b: { x: r.cx + ux * hl + nx * ht * s, y: r.cy + uy * hl + ny * ht * s }
	});
	return [edge(-1), edge(1)];
}

/** The point of the edge closest to p (the projection of p onto the edge line, held to the segment). */
export function projectOnEdge(e: Edge, p: Pt): Pt {
	const dx = e.b.x - e.a.x;
	const dy = e.b.y - e.a.y;
	const l2 = dx * dx + dy * dy;
	if (l2 === 0) return { ...e.a };
	const t = Math.min(1, Math.max(0, ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / l2));
	return { x: e.a.x + dx * t, y: e.a.y + dy * t };
}

/** The edge within `tol` of p, the closer one when both are; null when p is away from the ruler. */
export function nearEdge(r: Ruler, p: Pt, tol: number = SNAP_DISTANCE): Edge | null {
	if (!finite(p.x) || !finite(p.y)) return null;
	let best: Edge | null = null;
	let bestD = tol;
	for (const e of rulerEdges(r)) {
		const q = projectOnEdge(e, p);
		const d = Math.hypot(p.x - q.x, p.y - q.y);
		if (d <= bestD) {
			best = e;
			bestD = d;
		}
	}
	return best;
}

export const moveRuler = (r: Ruler, dx: number, dy: number): Ruler => ({
	...r,
	cx: r.cx + (finite(dx) ? dx : 0),
	cy: r.cy + (finite(dy) ? dy : 0)
});

export const rotateRuler = (r: Ruler, delta: number): Ruler => ({
	...r,
	angle: normalizeAngle(r.angle + (finite(delta) ? delta : 0))
});

/** Turn the ruler so its long side points from its center at p (dragging the rotate handle). */
export function aimRuler(r: Ruler, p: Pt): Ruler {
	const dx = p.x - r.cx;
	const dy = p.y - r.cy;
	if (!finite(dx) || !finite(dy) || (dx === 0 && dy === 0)) return r;
	return { ...r, angle: Math.atan2(dy, dx) };
}

/** Two fingers moving from (a0, b0) to (a1, b1): the ruler follows the midpoint and the twist. */
export function twoFingers(r: Ruler, a0: Pt, b0: Pt, a1: Pt, b1: Pt): Ruler {
	const turn = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x) || 0;
	const moved = moveRuler(
		r,
		(a1.x + b1.x) / 2 - (a0.x + b0.x) / 2,
		(a1.y + b1.y) / 2 - (a0.y + b0.y) / 2
	);
	return rotateRuler(moved, turn);
}
