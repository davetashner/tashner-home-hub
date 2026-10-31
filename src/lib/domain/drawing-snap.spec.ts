import { describe, expect, it } from 'vitest';
import type { DrawPoint, Stroke } from './drawing.js';
import {
	loadSnapPref,
	saveSnapPref,
	isSnappable,
	recognizeShape,
	snapStroke
} from './drawing-snap.js';

type P = [number, number];
let seed = 7;
const rnd = () => {
	seed = (seed * 16807) % 2147483647;
	return seed / 2147483647 - 0.5;
};
const pt = (x: number, y: number, jitter = 0, w = 7): DrawPoint => ({
	x: x + rnd() * jitter,
	y: y + rnd() * jitter,
	w
});
/** A polyline walked in small steps, with hand jitter. */
function walk(corners: P[], jitter = 3, step = 6): DrawPoint[] {
	const out: DrawPoint[] = [];
	for (let i = 1; i < corners.length; i++) {
		const [ax, ay] = corners[i - 1];
		const [bx, by] = corners[i];
		const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
		for (let k = i === 1 ? 0 : 1; k <= n; k++)
			out.push(pt(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, jitter));
	}
	return out;
}
function ellipse(cx: number, cy: number, rx: number, ry: number, turns = 1.04, jitter = 3) {
	const n = 70;
	return Array.from({ length: n + 1 }, (_, i) => {
		const t = (i / n) * Math.PI * 2 * turns - Math.PI / 2;
		return pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t), jitter);
	});
}
const snap = (pts: DrawPoint[]) => recognizeShape(pts, 'draw-red');

describe('recognizeShape: positives', () => {
	it('snaps a rough circle to a circle at the drawn place', () => {
		const s = snap(ellipse(300, 200, 80, 80))!;
		expect(s.shape.shape).toBe('circle');
		expect(s.shape.color).toBe('draw-red');
		expect(s.shape.filled).toBe(false);
		expect((s.shape.x0 + s.shape.x1) / 2).toBeCloseTo(300, -1);
		expect((s.shape.y0 + s.shape.y1) / 2).toBeCloseTo(200, -1);
		expect(s.confidence).toBeGreaterThan(0.55);
	});
	it('snaps a wide loop to an oval and keeps its box', () => {
		const s = snap(ellipse(300, 200, 120, 55))!;
		expect(s.shape.shape).toBe('oval');
		expect(Math.abs(s.shape.x1 - s.shape.x0)).toBeGreaterThan(200);
		expect(Math.abs(s.shape.y1 - s.shape.y0)).toBeLessThan(130);
	});
	it('snaps a rough square to an even square', () => {
		const s = snap(
			walk([
				[100, 100],
				[200, 100],
				[200, 200],
				[100, 200],
				[101, 98]
			])
		)!;
		expect(s.shape.shape).toBe('square');
		expect(Math.abs(s.shape.x1 - s.shape.x0)).toBeCloseTo(Math.abs(s.shape.y1 - s.shape.y0), 0);
	});
	it('snaps a rectangle and keeps its proportions', () => {
		const s = snap(
			walk([
				[100, 100],
				[300, 100],
				[300, 180],
				[100, 180],
				[101, 98]
			])
		)!;
		expect(s.shape.shape).toBe('square');
		expect(s.shape.x1 - s.shape.x0).toBeGreaterThan(150);
		expect(s.shape.y1 - s.shape.y0).toBeLessThan(120);
	});
	it('snaps a triangle', () => {
		const s = snap(
			walk([
				[200, 100],
				[280, 220],
				[120, 220],
				[200, 102]
			])
		)!;
		expect(s.shape.shape).toBe('triangle');
	});
	it('snaps a straight line in any direction, start to end', () => {
		const s = snap(
			walk(
				[
					[50, 300],
					[350, 120]
				],
				2
			)
		)!;
		expect(s.shape.shape).toBe('line');
		expect(s.shape.x0).toBeCloseTo(50, -1);
		expect(s.shape.y1).toBeCloseTo(120, -1);
	});
	it('snaps a shaft with a hooked head to an arrow', () => {
		const s = snap(
			walk(
				[
					[50, 200],
					[300, 200],
					[265, 170],
					[300, 200],
					[265, 230]
				],
				1.5
			)
		)!;
		expect(s.shape.shape).toBe('arrow');
		expect(s.shape.x1).toBeCloseTo(300, -1);
	});
	it('maps the stroke width onto the shape', () => {
		const pts = ellipse(200, 200, 70, 70).map((p) => ({ ...p, w: 12 }));
		expect(snap(pts)!.shape.width).toBe(12);
	});
	it('accepts a drawn direction either way round and an overshoot', () => {
		const rev = ellipse(300, 200, 80, 80, 1.1).reverse();
		expect(snap(rev)?.shape.shape).toBe('circle');
	});
});

describe('recognizeShape: negatives', () => {
	it('ignores taps, dots and short strokes', () => {
		expect(snap([pt(5, 5)])).toBeNull();
		expect(
			snap(
				walk(
					[
						[10, 10],
						[30, 12]
					],
					1
				)
			)
		).toBeNull();
		expect(snap(ellipse(50, 50, 8, 8))).toBeNull();
	});
	it('ignores a scribble', () => {
		const pts: DrawPoint[] = [];
		for (let i = 0; i < 90; i++)
			pts.push(pt(150 + Math.sin(i * 1.9) * 60, 150 + Math.cos(i * 2.7) * 50, 8));
		expect(snap(pts)).toBeNull();
	});
	it('ignores a zig-zag', () => {
		expect(
			snap(
				walk([
					[50, 100],
					[100, 200],
					[150, 100],
					[200, 200],
					[250, 100],
					[300, 200]
				])
			)
		).toBeNull();
	});
	it('ignores an S', () => {
		const pts: DrawPoint[] = [];
		for (let i = 0; i <= 60; i++) {
			const t = i / 60;
			const a = Math.PI * 1.9 * (t < 0.5 ? t * 2 : 2 - t * 2) * (t < 0.5 ? 1 : -1);
			pts.push(pt(200 + (t < 0.5 ? -1 : 1) * 40 * Math.sin(t * Math.PI * 2), 100 + t * 200, 2));
			void a;
		}
		expect(snap(pts)).toBeNull();
	});
	it('ignores 200 random hand-waves', () => {
		let hits = 0;
		for (let k = 0; k < 200; k++) {
			const pts: DrawPoint[] = [];
			let x = 200;
			let y = 200;
			let a = rnd() * 6;
			for (let i = 0; i < 80; i++) {
				a += rnd() * 1.4;
				x += Math.cos(a) * 8;
				y += Math.sin(a) * 8;
				pts.push(pt(x, y));
			}
			if (snap(pts)) hits++;
		}
		expect(hits).toBe(0);
	});
	it('ignores a lowercase e', () => {
		const pts: DrawPoint[] = [];
		for (let i = 0; i <= 12; i++) pts.push(pt(120 + i * 8, 150, 1)); // the bar
		for (let i = 1; i <= 50; i++) {
			const t = (i / 50) * Math.PI * 1.7;
			pts.push(pt(168 + 48 * Math.cos(t), 150 + 48 * Math.sin(t) * 1.1, 1));
		}
		expect(snap(pts)).toBeNull();
	});
	it('ignores a spiral', () => {
		const pts: DrawPoint[] = [];
		for (let i = 0; i <= 120; i++) {
			const t = (i / 120) * Math.PI * 5;
			pts.push(pt(200 + (20 + t * 8) * Math.cos(t), 200 + (20 + t * 8) * Math.sin(t), 1));
		}
		expect(snap(pts)).toBeNull();
	});
	it('ignores a V, a check mark and a wavy line', () => {
		expect(
			snap(
				walk([
					[100, 100],
					[160, 220],
					[220, 100]
				])
			)
		).toBeNull();
		expect(
			snap(
				walk([
					[100, 180],
					[140, 230],
					[260, 100]
				])
			)
		).toBeNull();
		const wave = Array.from({ length: 60 }, (_, i) =>
			pt(50 + i * 6, 150 + Math.sin(i / 3) * 30, 1)
		);
		expect(snap(wave)).toBeNull();
	});
	it('ignores an open C and a heart-ish blob', () => {
		expect(snap(ellipse(300, 200, 80, 80, 0.7))).toBeNull();
		const blob = Array.from({ length: 70 }, (_, i) => {
			const t = (i / 69) * Math.PI * 2;
			const r = 70 + 28 * Math.sin(t * 3);
			return pt(200 + r * Math.cos(t), 200 + r * Math.sin(t), 2);
		});
		expect(snap(blob)).toBeNull();
	});
});

describe('snapStroke / isSnappable', () => {
	const circle = (extra: Partial<Stroke> & Record<string, unknown> = {}): Stroke =>
		({ tool: 'pen', color: 'draw-blue', points: ellipse(300, 200, 80, 80), ...extra }) as Stroke;
	it('snaps a plain pen stroke', () => expect(snapStroke(circle())?.shape).toBe('circle'));
	it('never snaps eraser, highlighter, mirrored, textured or see-through strokes', () => {
		expect(isSnappable(circle({ tool: 'eraser' }))).toBe(false);
		expect(isSnappable(circle({ tool: 'highlighter' }))).toBe(false);
		expect(snapStroke(circle({ mirror: { n: 2, cx: 1, cy: 1 } as never }))).toBeNull();
		expect(isSnappable(circle({ tool: 'crayon' as never }))).toBe(false);
		expect(snapStroke(circle({ alpha: 0.5 }))).toBeNull();
		expect(isSnappable(circle({ alpha: 1 }))).toBe(true);
	});
});

describe('snap preference', () => {
	const mem = () => {
		const m = new Map<string, string>();
		return {
			getItem: (k: string) => m.get(k) ?? null,
			setItem: (k: string, v: string) => void m.set(k, v)
		};
	};
	it('defaults to off and remembers on', () => {
		const store = mem();
		expect(loadSnapPref(store)).toBe(false);
		saveSnapPref(true, store);
		expect(loadSnapPref(store)).toBe(true);
		saveSnapPref(false, store);
		expect(loadSnapPref(store)).toBe(false);
	});
	it('survives storage that throws or is missing', () => {
		const bad = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		expect(loadSnapPref(bad)).toBe(false);
		expect(() => saveSnapPref(true, bad)).not.toThrow();
		expect(loadSnapPref(null)).toBe(false);
		expect(() => saveSnapPref(true, null)).not.toThrow();
	});
});
