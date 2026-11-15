import { describe, expect, it } from 'vitest';
import type { Stroke } from './drawing.js';
import { loadDrawing, serializeDrawing } from './drawing-save.js';
import {
	MAX_GROUP,
	MOTIONS,
	PERIOD,
	groupCentres,
	hasMotion,
	isAnimated,
	isMotionKind,
	motionAt,
	motionWire,
	nextGroup,
	parseMotionWire,
	setMotion,
	stopMotion,
	stripMotion
} from './drawing-animate.js';

const size = { w: 1000, h: 800 };
const stroke = (x: number, y: number, extra: Partial<Stroke> = {}): Stroke => ({
	tool: 'pen',
	color: '#000000',
	points: [
		{ x, y, w: 4 },
		{ x: x + 20, y: y + 20, w: 4 }
	],
	...extra
});

describe('motionAt', () => {
	it.each(MOTIONS)('%s starts at rest, loops without a jump and stays on the board', (kind) => {
		const o = motionAt(kind, 0, size);
		expect(Math.abs(o.dx)).toBeLessThan(1e-9);
		expect(Math.abs(o.dy)).toBeLessThan(1e-9);
		const end = motionAt(kind, PERIOD[kind], size);
		expect(end.dx).toBeCloseTo(0, 6);
		expect(end.dy).toBeCloseTo(0, 6);
		for (let t = 0; t < PERIOD[kind]; t += 0.05) {
			const m = motionAt(kind, t, size);
			expect(Math.abs(m.dx)).toBeLessThanOrEqual(size.w * 0.25);
			expect(Math.abs(m.dy)).toBeLessThanOrEqual(size.h * 0.5 + 1e-6);
			expect(Math.abs(m.rot)).toBeLessThan(0.5);
		}
	});

	it('each motion has its own character', () => {
		const at = (k: (typeof MOTIONS)[number], t: number) => motionAt(k, t, size);
		expect(at('swim', 1.5).dx).toBeGreaterThan(100); // drifts across
		expect(at('fly', 2.5).dy).toBeLessThan(0); // rises
		expect(at('bounce', 0.6).dy).toBeLessThan(-50); // hops up
		expect(at('bounce', 0.6).dx).toBe(0);
		expect(at('launch', 3 * 0.35).dy).toBeCloseTo(-size.h * 0.5, 6); // peak
		expect(at('launch', 3 * 0.35).dy).toBeLessThan(at('launch', 2.5).dy); // then comes back down
	});

	it('scales with the board and shifts by phase', () => {
		expect(motionAt('launch', 1, { w: 2000, h: 1600 }).dy).toBeCloseTo(
			2 * motionAt('launch', 1, size).dy,
			6
		);
		expect(motionAt('bounce', 0, size, 0.6).dy).not.toBe(0);
		expect(motionAt('swim', -1, size).dx).toBeCloseTo(
			motionAt('swim', PERIOD.swim - 1, size).dx,
			6
		);
	});

	it('is still for malformed input', () => {
		const still = { dx: 0, dy: 0, rot: 0 };
		expect(motionAt('wobble' as never, 1, size)).toEqual(still);
		expect(motionAt('swim', NaN, size)).toEqual(still);
		expect(motionAt('swim', 1, { w: 0, h: 10 })).toEqual(still);
		expect(motionAt('swim', 1, { w: 10, h: NaN })).toEqual(still);
		expect(motionAt('swim', 1.5, size, NaN)).toEqual(motionAt('swim', 1.5, size));
	});
});

describe('assigning motion', () => {
	const items = [stroke(0, 0), stroke(100, 0), stroke(200, 0)];

	it('puts the picked strokes in one new group, leaving the rest and the originals alone', () => {
		const out = setMotion(items, [0, 2], 'fly');
		expect(out[0].motion).toEqual({ kind: 'fly', group: 1 });
		expect(out[2].motion).toEqual({ kind: 'fly', group: 1 });
		expect(out[1]).toBe(items[1]);
		expect(items[0].motion).toBeUndefined();
		expect(hasMotion(items)).toBe(false);
		expect(hasMotion(out)).toBe(true);
	});

	it('a second pick is a second group with its own motion', () => {
		const a = setMotion(items, [0], 'swim');
		const b = setMotion(a, [1], 'bounce');
		expect(b[1].motion).toEqual({ kind: 'bounce', group: 2 });
		expect(b[0].motion).toEqual({ kind: 'swim', group: 1 });
		expect(nextGroup(b)).toBe(3);
	});

	it('re-picking a motion for animated strokes replaces it', () => {
		const a = setMotion(items, [0], 'swim');
		expect(setMotion(a, [0], 'launch')[0].motion?.kind).toBe('launch');
	});

	it('skips things that are not strokes and indices out of range', () => {
		const mixed = [stroke(0, 0), { shape: 'box' }, null];
		const out = setMotion(mixed, [0, 1, 2, 9], 'swim');
		expect(out[1]).toBe(mixed[1]);
		expect(out[2]).toBeNull();
		expect(out).toHaveLength(3);
	});

	it('caps the group id', () => {
		const top = [stroke(0, 0, { motion: { kind: 'fly', group: MAX_GROUP } })];
		expect(nextGroup(top)).toBe(MAX_GROUP);
		expect(nextGroup([])).toBe(1);
	});

	it('stop clears some or all motion', () => {
		const a = setMotion(items, [0, 1], 'swim');
		const some = stopMotion(a, [0]);
		expect(some[0].motion).toBeUndefined();
		expect(some[1].motion).toBeDefined();
		expect(some[2]).toBe(a[2]);
		expect(hasMotion(stopMotion(a))).toBe(false);
		expect(stopMotion(a, [2])[1]).toBe(a[1]);
		expect(a[0].motion).toBeDefined();
	});

	it('stripMotion copies without the motion', () => {
		const s = stroke(0, 0, { motion: { kind: 'fly', group: 1 } });
		expect(stripMotion(s).motion).toBeUndefined();
		expect(s.motion).toBeDefined();
	});

	it('isAnimated rejects non-strokes', () => {
		expect(isAnimated(null)).toBe(false);
		expect(isAnimated('x')).toBe(false);
		expect(isAnimated(stroke(0, 0))).toBe(false);
	});
});

describe('groupCentres', () => {
	it('is the middle of each group, and ignores still ink', () => {
		const a = setMotion([stroke(0, 0), stroke(100, 100), stroke(500, 500)], [0, 1], 'swim');
		const c = groupCentres(a);
		expect(c.size).toBe(1);
		expect(c.get(1)!.x).toBeGreaterThan(50);
		expect(c.get(1)!.x).toBeLessThan(80);
	});

	it('is empty for no motion or for strokes with no points', () => {
		expect(groupCentres([stroke(0, 0)]).size).toBe(0);
		const empty = stroke(0, 0, { motion: { kind: 'fly', group: 1 }, points: [] });
		expect(groupCentres([empty]).size).toBe(0);
	});
});

describe('wire form', () => {
	it('round-trips and rejects junk', () => {
		const m = { kind: 'launch', group: 3 } as const;
		expect(parseMotionWire(motionWire(m))).toEqual(m);
		for (const bad of [
			undefined,
			null,
			'swim',
			[],
			['swim'],
			['swim', 0],
			['swim', 1.5],
			['swim', MAX_GROUP + 1],
			['walk', 1],
			['swim', '1'],
			['swim', 1, 2]
		])
			expect(parseMotionWire(bad)).toBeUndefined();
		expect(isMotionKind('fly')).toBe(true);
		expect(isMotionKind(3)).toBe(false);
	});

	it('is saved with the drawing and reopens, old saves have none, a bad one loads still', () => {
		const s = { w: 400, h: 300 };
		const items = setMotion([stroke(10, 10), stroke(50, 50)], [1], 'bounce');
		const json = serializeDrawing(items, s);
		const back = loadDrawing(json, s) as Stroke[];
		expect(back[0].motion).toBeUndefined();
		expect(back[1].motion).toEqual({ kind: 'bounce', group: 1 });
		expect(JSON.parse(serializeDrawing([stroke(1, 1)], s)).items[0].n).toBeUndefined();
		const bad = JSON.parse(json);
		bad.items[1].n = ['teleport', 1];
		const loaded = loadDrawing(JSON.stringify(bad), s) as Stroke[];
		expect(loaded).toHaveLength(2);
		expect(loaded[1].motion).toBeUndefined();
	});
});
