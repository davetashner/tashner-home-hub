import { describe, expect, it } from 'vitest';
import {
	aimRuler,
	clampRuler,
	defaultRuler,
	moveRuler,
	nearEdge,
	normalizeAngle,
	projectOnEdge,
	rotateRuler,
	rulerEdges,
	twoFingers,
	type Ruler
} from './drawing-ruler.js';

const flat: Ruler = { cx: 500, cy: 400, angle: 0, len: 600, thick: 100 };

describe('rulerEdges', () => {
	it('puts the edges half a thickness above and below the center line', () => {
		const [top, bottom] = rulerEdges(flat);
		expect(top.a).toEqual({ x: 200, y: 350 });
		expect(top.b).toEqual({ x: 800, y: 350 });
		expect(bottom.a.y).toBe(450);
	});
	it('turns with the angle', () => {
		const [top] = rulerEdges({ ...flat, angle: Math.PI / 2 });
		expect(top.a.x).toBeCloseTo(550);
		expect(top.a.y).toBeCloseTo(100);
		expect(top.b.y).toBeCloseTo(700);
	});
});

describe('projectOnEdge', () => {
	const [top] = rulerEdges(flat);
	it('drops a point straight onto the edge', () => {
		expect(projectOnEdge(top, { x: 500, y: 330 })).toEqual({ x: 500, y: 350 });
	});
	it('holds the point to the ends of the edge', () => {
		expect(projectOnEdge(top, { x: 50, y: 300 })).toEqual({ x: 200, y: 350 });
		expect(projectOnEdge(top, { x: 5000, y: 300 })).toEqual({ x: 800, y: 350 });
	});
	it('handles a zero-length edge', () => {
		expect(projectOnEdge({ a: { x: 1, y: 2 }, b: { x: 1, y: 2 } }, { x: 9, y: 9 })).toEqual({
			x: 1,
			y: 2
		});
	});
	it('works on a slanted edge', () => {
		const [e] = rulerEdges({ ...flat, angle: Math.PI / 4 });
		const q = projectOnEdge(e, { x: e.a.x + 100, y: e.a.y + 100 });
		expect(q.x - e.a.x).toBeCloseTo(q.y - e.a.y);
	});
});

describe('nearEdge', () => {
	it('finds the edge a stroke starts beside, on either side', () => {
		expect(nearEdge(flat, { x: 500, y: 330 }, 40)?.a.y).toBe(350);
		expect(nearEdge(flat, { x: 500, y: 470 }, 40)?.a.y).toBe(450);
	});
	it('also counts a start just inside the ruler body', () => {
		expect(nearEdge(flat, { x: 500, y: 365 }, 40)?.a.y).toBe(350);
	});
	it('ignores strokes away from the edges', () => {
		expect(nearEdge(flat, { x: 500, y: 100 }, 40)).toBeNull();
		expect(nearEdge(flat, { x: 500, y: 400 }, 40)).toBeNull(); // middle of the body
		expect(nearEdge(flat, { x: 1500, y: 350 }, 40)).toBeNull(); // past the end
	});
	it('picks the closer edge on a thin ruler', () => {
		expect(nearEdge({ ...flat, thick: 20 }, { x: 500, y: 407 }, 40)?.a.y).toBe(410);
	});
	it('rejects malformed points', () => {
		expect(nearEdge(flat, { x: NaN, y: 350 })).toBeNull();
		expect(nearEdge(flat, { x: 1, y: Infinity })).toBeNull();
	});
	it('uses a default tolerance', () => {
		expect(nearEdge(flat, { x: 500, y: 330 })).not.toBeNull();
	});
});

describe('move and rotate', () => {
	it('moves', () => {
		expect(moveRuler(flat, 10, -5)).toMatchObject({ cx: 510, cy: 395 });
		expect(moveRuler(flat, NaN, NaN)).toMatchObject({ cx: 500, cy: 400 });
	});
	it('rotates and wraps the angle', () => {
		expect(rotateRuler(flat, Math.PI / 2).angle).toBeCloseTo(Math.PI / 2);
		expect(rotateRuler({ ...flat, angle: 3 }, 1).angle).toBeCloseTo(4 - 2 * Math.PI);
		expect(rotateRuler(flat, NaN).angle).toBe(0);
	});
	it('normalizes angles', () => {
		expect(normalizeAngle(2 * Math.PI)).toBeCloseTo(0);
		expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
		expect(normalizeAngle(NaN)).toBe(0);
	});
	it('aims at a point, and ignores the center itself', () => {
		expect(aimRuler(flat, { x: 500, y: 900 }).angle).toBeCloseTo(Math.PI / 2);
		expect(aimRuler(flat, { x: 500, y: 400 })).toBe(flat);
		expect(aimRuler(flat, { x: NaN, y: 1 })).toBe(flat);
	});
	it('follows two fingers: move by the midpoint, turn by the twist', () => {
		const r = twoFingers(
			flat,
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 10, y: 20 },
			{ x: 10, y: 120 }
		);
		expect(r.angle).toBeCloseTo(Math.PI / 2);
		expect(r.cx).toBeCloseTo(500 - 40);
		expect(r.cy).toBeCloseTo(400 + 20 + 50);
		expect(
			twoFingers(flat, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 })
		).toEqual(flat);
	});
});

describe('defaultRuler and clampRuler', () => {
	it('starts centered and fits a narrow board', () => {
		expect(defaultRuler({ w: 3000, h: 1600 })).toMatchObject({ cx: 1500, cy: 800, len: 1200 });
		expect(defaultRuler({ w: 500, h: 400 }).len).toBe(400);
		expect(defaultRuler({ w: 0, h: NaN })).toMatchObject({ cx: 600, cy: 600 });
	});
	it('keeps the center on the board', () => {
		expect(clampRuler({ ...flat, cx: -50, cy: 9999 }, { w: 1000, h: 800 })).toMatchObject({
			cx: 0,
			cy: 800
		});
		expect(clampRuler({ ...flat, cx: NaN, angle: NaN }, { w: 1000, h: 800 })).toMatchObject({
			cx: 500,
			angle: 0
		});
		expect(clampRuler(flat, { w: NaN, h: -3 })).toMatchObject({ cx: 0, cy: 0 });
	});
});
