import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUnlocked, loadProgress, parseProgress, recordResult, saveProgress } from './progress.js';

describe('progress', () => {
	it('parses defensively', () => {
		expect(parseProgress(null)).toEqual({});
		expect(parseProgress([1])).toEqual({});
		expect(parseProgress({ a: 2, b: 'x', c: 9, d: 0, e: NaN, f: 1.7 })).toEqual({
			a: 2,
			c: 3,
			f: 1
		});
	});

	it('never lowers a best and does not mutate', () => {
		const p = { a: 3 };
		expect(recordResult(p, 'a', 1)).toEqual({ a: 3 });
		expect(recordResult(p, 'a', 3)).toEqual({ a: 3 });
		expect(recordResult({ a: 1 }, 'a', 2)).toEqual({ a: 2 });
		expect(recordResult(p, 'b', 0)).toEqual({ a: 3 });
		expect(recordResult(p, 'b', 2)).toEqual({ a: 3, b: 2 });
		expect(p).toEqual({ a: 3 });
	});

	it('unlocks level 1, then each level after a win', () => {
		const ids = ['a', 'b', 'c'];
		expect(isUnlocked({}, ids, 0)).toBe(true);
		expect(isUnlocked({}, ids, 1)).toBe(false);
		expect(isUnlocked({ a: 1 }, ids, 1)).toBe(true);
		expect(isUnlocked({ a: 1 }, ids, 2)).toBe(false);
		expect(isUnlocked({}, ids, 9)).toBe(false);
	});

	describe('storage', () => {
		afterEach(() => vi.unstubAllGlobals());
		function stub() {
			const m = new Map<string, string>();
			vi.stubGlobal('localStorage', {
				getItem: (k: string) => m.get(k) ?? null,
				setItem: (k: string, v: string) => void m.set(k, v)
			});
		}
		it('keeps kids apart and round-trips', () => {
			stub();
			saveProgress('m1', { a: 2 });
			expect(loadProgress('m1')).toEqual({ a: 2 });
			expect(loadProgress('m2')).toEqual({});
			expect(loadProgress(null)).toEqual({});
			saveProgress(null, { b: 1 });
			expect(loadProgress(null)).toEqual({ b: 1 });
		});
		it('survives broken storage', () => {
			vi.stubGlobal('localStorage', {
				getItem: () => {
					throw new Error('no');
				},
				setItem: () => {
					throw new Error('no');
				}
			});
			expect(loadProgress('m1')).toEqual({});
			expect(() => saveProgress('m1', { a: 1 })).not.toThrow();
		});
	});
});
