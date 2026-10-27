import { describe, expect, it } from 'vitest';
import { goalProgress, parseGoalInput } from './savings-goals.js';

describe('parseGoalInput', () => {
	it('accepts a full goal and trims the title', () => {
		expect(parseGoalInput({ title: ' Bike ', emoji: '🚲', targetCents: 12000 }, false)).toEqual({
			ok: true,
			value: { title: 'Bike', emoji: '🚲', targetCents: 12000 }
		});
	});
	it('treats empty emoji as none and allows partial edits', () => {
		expect(parseGoalInput({ emoji: '' }, true)).toEqual({ ok: true, value: { emoji: null } });
		expect(parseGoalInput({ emoji: null }, true)).toEqual({ ok: true, value: { emoji: null } });
		expect(parseGoalInput({}, true)).toEqual({ ok: true, value: {} });
	});
	it('requires title and price on create', () => {
		expect(parseGoalInput({ targetCents: 500 }, false).ok).toBe(false);
		expect(parseGoalInput({ title: 'x' }, false).ok).toBe(false);
	});
	it.each([
		['not an object', 'nope'],
		['array', []],
		['null', null],
		['long title', { title: 'a'.repeat(41), targetCents: 500 }],
		['blank title', { title: '  ', targetCents: 500 }],
		['non-string title', { title: 4, targetCents: 500 }],
		['two emoji', { title: 'a', emoji: '🚲🚲', targetCents: 500 }],
		['letters as emoji', { title: 'a', emoji: 'a', targetCents: 500 }],
		['number emoji', { title: 'a', emoji: 5, targetCents: 500 }],
		['fractional price', { title: 'a', targetCents: 500.5 }],
		['string price', { title: 'a', targetCents: '500' }],
		['too cheap', { title: 'a', targetCents: 99 }],
		['too dear', { title: 'a', targetCents: 1_000_001 }]
	])('rejects %s', (_n, input) => {
		expect(parseGoalInput(input, false).ok).toBe(false);
	});
});

describe('goalProgress', () => {
	it('caps at the price and floors at zero', () => {
		expect(goalProgress(300, 1000)).toEqual({ savedCents: 300, targetCents: 1000, reached: false });
		expect(goalProgress(5000, 1000)).toEqual({
			savedCents: 1000,
			targetCents: 1000,
			reached: true
		});
		expect(goalProgress(-5, 1000).savedCents).toBe(0);
	});
});
