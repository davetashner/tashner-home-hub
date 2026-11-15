import { describe, expect, it } from 'vitest';
import {
	SMOOTH_STORAGE_KEY,
	createSmoother,
	jitter,
	loadSmoothPref,
	saveSmoothPref,
	smoothPoints
} from './drawing-smooth.js';

/** A straight diagonal line with deterministic wobble. */
const noisy = (n = 60) =>
	Array.from({ length: n }, (_, i) => ({
		x: i * 10 + Math.sin(i * 7.3) * 6,
		y: i * 5 + Math.cos(i * 5.1) * 6,
		w: 4
	}));

describe('smoothing', () => {
	it('measurably reduces jitter on a noisy line', () => {
		const raw = noisy();
		const out = smoothPoints(raw);
		expect(jitter(out)).toBeLessThan(jitter(raw) * 0.5);
	});
	it('keeps the end of the stroke at the finger', () => {
		const raw = noisy();
		const out = smoothPoints(raw);
		expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
		expect(out[0]).toEqual(raw[0]);
	});
	it('leaves a straight line straight and a stationary finger alone', () => {
		const line = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0, w: 3 }));
		expect(smoothPoints(line).every((p) => p.y === 0)).toBe(true);
		const s = createSmoother();
		s.push({ x: 5, y: 5, w: 1 });
		s.push({ x: 5, y: 5, w: 1 });
		expect(s.finish()).toBeNull();
	});
	it('ignores malformed samples and clamps a silly alpha', () => {
		const s = createSmoother(Number.NaN);
		expect(s.push({ x: Number.NaN, y: 0, w: 1 })).toBeNull();
		expect(s.push(null as never)).toBeNull();
		expect(s.finish()).toBeNull();
		expect(s.push({ x: 0, y: 0, w: Number.NaN })?.w).toBe(1);
		const full = createSmoother(5);
		full.push({ x: 0, y: 0, w: 1 });
		expect(full.push({ x: 10, y: 10, w: 1 })).toEqual({ x: 10, y: 10, w: 1 });
		expect(smoothPoints([])).toEqual([]);
	});
	it('jitter is 0 for fewer than three points', () => {
		expect(jitter([{ x: 0, y: 0 }])).toBe(0);
	});
});

describe('smooth preference', () => {
	it('defaults to off and round-trips', () => {
		const mem = new Map<string, string>();
		const store = {
			getItem: (k: string) => mem.get(k) ?? null,
			setItem: (k: string, v: string) => void mem.set(k, v)
		};
		expect(loadSmoothPref(store)).toBe(false);
		saveSmoothPref(true, store);
		expect(mem.get(SMOOTH_STORAGE_KEY)).toBe('on');
		expect(loadSmoothPref(store)).toBe(true);
		saveSmoothPref(false, store);
		expect(loadSmoothPref(store)).toBe(false);
	});
	it('survives missing or throwing storage', () => {
		const bad = {
			getItem: () => {
				throw new Error('x');
			},
			setItem: () => {
				throw new Error('x');
			}
		};
		expect(loadSmoothPref(bad)).toBe(false);
		expect(() => saveSmoothPref(true, bad)).not.toThrow();
		expect(loadSmoothPref(null)).toBe(false);
		expect(() => saveSmoothPref(true, null)).not.toThrow();
	});
});
