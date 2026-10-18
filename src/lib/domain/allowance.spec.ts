import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RATE,
	cashoutUnit,
	centsForStars,
	formatMoney,
	maxCashout,
	parseMoney,
	parseRate,
	planAdjustment,
	planCashout,
	planPayout
} from './allowance.js';

const third = { stars: 3, cents: 100, symbol: '$' };

describe('parseRate', () => {
	it('accepts a valid rate', () => {
		expect(parseRate({ stars: 10, cents: 100, symbol: ' £ ' })).toEqual({
			ok: true,
			rate: { stars: 10, cents: 100, symbol: '£' }
		});
	});
	it('defaults the symbol when omitted', () => {
		expect(parseRate({ stars: 5, cents: 50 })).toMatchObject({ ok: true });
	});
	it.each([
		[{ stars: 0, cents: 100 }],
		[{ stars: 1.5, cents: 100 }],
		[{ stars: 1001, cents: 100 }],
		[{ stars: 10, cents: 0 }],
		[{ stars: 10, cents: 100001 }],
		[{ stars: 10, cents: 100, symbol: '' }],
		[{ stars: 10, cents: 100, symbol: 'abcd' }],
		[null]
	])('rejects %j', (input) => {
		expect(parseRate(input).ok).toBe(false);
	});
});

describe('conversion', () => {
	it('computes the cash-out unit', () => {
		expect(cashoutUnit(DEFAULT_RATE)).toBe(1);
		expect(cashoutUnit(third)).toBe(3);
		expect(cashoutUnit({ stars: 4, cents: 50, symbol: '$' })).toBe(2);
	});
	it('floors to whole cents', () => {
		expect(centsForStars(10, DEFAULT_RATE)).toBe(100);
		expect(centsForStars(1, third)).toBe(33);
		expect(centsForStars(0, third)).toBe(0);
		expect(centsForStars(-2, third)).toBe(0);
		expect(centsForStars(1.5, third)).toBe(0);
	});
	it('limits the max cash-out to whole units', () => {
		expect(maxCashout(10, third)).toBe(9);
		expect(maxCashout(2, third)).toBe(0);
		expect(maxCashout(7, DEFAULT_RATE)).toBe(7);
	});
});

describe('planCashout', () => {
	it('plans a valid cash-out', () => {
		expect(planCashout(20, 25, DEFAULT_RATE)).toEqual({ ok: true, stars: 20, cents: 200 });
	});
	it('refuses non-integers, zero and negatives', () => {
		for (const bad of [0, -1, 1.5, '5', null])
			expect(planCashout(bad, 50, DEFAULT_RATE).ok).toBe(false);
	});
	it('refuses a count that is not a multiple of the unit', () => {
		const r = planCashout(4, 50, third);
		expect(r).toEqual({ ok: false, error: 'Cash out in groups of 3 stars.' });
		expect(planCashout(4, 50, { stars: 1, cents: 5, symbol: '$' }).ok).toBe(true);
		expect(planCashout(1, 50, { stars: 2, cents: 1, symbol: '$' })).toMatchObject({
			error: 'Cash out in groups of 2 stars.'
		});
		expect(planCashout(5, 50, { stars: 10, cents: 5, symbol: '$' })).toMatchObject({
			error: 'Cash out in groups of 2 stars.'
		});
	});
	it('says "star" for a unit of one', () => {
		expect(cashoutUnit({ stars: 1, cents: 1, symbol: '$' })).toBe(1);
	});
	it('refuses more than the balance', () => {
		expect(planCashout(30, 25, DEFAULT_RATE)).toEqual({
			ok: false,
			error: 'Only 25 stars to cash out.'
		});
	});
	it('refuses an enormous single entry', () => {
		const rate = { stars: 1, cents: 100_000, symbol: '$' };
		expect(planCashout(11, 100, rate).ok).toBe(false);
	});
});

describe('formatMoney / parseMoney', () => {
	it('formats cents', () => {
		expect(formatMoney(450)).toBe('$4.50');
		expect(formatMoney(5)).toBe('$0.05');
		expect(formatMoney(0)).toBe('$0.00');
		expect(formatMoney(-100, '£')).toBe('-£1.00');
	});
	it('parses plain amounts', () => {
		expect(parseMoney('4.50')).toBe(450);
		expect(parseMoney('4')).toBe(400);
		expect(parseMoney('.5')).toBe(50);
		expect(parseMoney('4.5')).toBe(450);
		expect(parseMoney(' -1.25 ')).toBe(-125);
		expect(parseMoney('0.07')).toBe(7);
	});
	it.each(['', '.', 'abc', '1.234', '$4', '1,5', '--1'])('rejects %j', (t) => {
		expect(parseMoney(t)).toBeNull();
	});
});

describe('planPayout / planAdjustment', () => {
	it('plans a payout within the balance', () => {
		expect(planPayout(450, 450)).toEqual({ ok: true, cents: 450, note: '' });
	});
	it('refuses bad payouts', () => {
		expect(planPayout(0, 100).ok).toBe(false);
		expect(planPayout(1.5, 100).ok).toBe(false);
		expect(planPayout(101, 100)).toMatchObject({ error: 'That is more than the balance.' });
		expect(planPayout(2_000_000, 3_000_000).ok).toBe(false);
	});
	it('requires a note for adjustments', () => {
		expect(planAdjustment(-50, '  Lost coin ')).toEqual({
			ok: true,
			cents: -50,
			note: 'Lost coin'
		});
		expect(planAdjustment(50, '').ok).toBe(false);
		expect(planAdjustment(50, 7).ok).toBe(false);
		expect(planAdjustment(0, 'x').ok).toBe(false);
		expect(planAdjustment(2_000_000, 'x').ok).toBe(false);
		expect(planAdjustment(5, 'x'.repeat(201)).ok).toBe(false);
	});
});
