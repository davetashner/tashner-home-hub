import { describe, expect, it } from 'vitest';
import { MAX_LOCK_MS, PinLimiter, lockoutMs } from './pin-limiter';

describe('lockoutMs', () => {
	it('is free for the first 4 failures, 60 s at the 5th, then doubles to a 15 min cap', () => {
		expect([1, 2, 3, 4].map(lockoutMs)).toEqual([0, 0, 0, 0]);
		expect([5, 6, 7, 8].map(lockoutMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
		expect(lockoutMs(9)).toBe(MAX_LOCK_MS);
		expect(lockoutMs(10_000)).toBe(MAX_LOCK_MS);
	});
});

describe('PinLimiter', () => {
	it('locks after 5 failures and unlocks after the delay', () => {
		const l = new PinLimiter();
		for (let i = 0; i < 4; i++) expect(l.recordFailure('a', 0)).toBe(0);
		expect(l.remainingMs('a', 0)).toBe(0);
		expect(l.recordFailure('a', 1000)).toBe(60_000);
		expect(l.remainingMs('a', 1000)).toBe(60_000);
		expect(l.remainingMs('a', 31_000)).toBe(30_000);
		expect(l.remainingMs('a', 61_000)).toBe(0);
		expect(l.recordFailure('a', 61_000)).toBe(120_000);
	});
	it('isolates keys and resets on success', () => {
		const l = new PinLimiter();
		for (let i = 0; i < 5; i++) l.recordFailure('a', 0);
		expect(l.remainingMs('b', 0)).toBe(0);
		l.recordSuccess('a');
		expect(l.remainingMs('a', 0)).toBe(0);
		expect(l.recordFailure('a', 0)).toBe(0);
	});
});
