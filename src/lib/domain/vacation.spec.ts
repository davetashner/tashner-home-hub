import { describe, expect, it } from 'vitest';
import { isVacationDay, parseVacation } from './vacation.js';

describe('parseVacation', () => {
	it('accepts a range and an open-ended start', () => {
		expect(parseVacation({ start: '2026-07-01', back: '2026-07-08' })).toEqual({
			start: '2026-07-01',
			back: '2026-07-08'
		});
		expect(parseVacation({ start: '2026-07-01', back: null })).toEqual({
			start: '2026-07-01',
			back: null
		});
		expect(parseVacation({ start: '2026-07-01' })?.back).toBeNull();
	});

	it('rejects bad input', () => {
		expect(parseVacation(null)).toBeNull();
		expect(parseVacation('x')).toBeNull();
		expect(parseVacation({})).toBeNull();
		expect(parseVacation({ start: '2026-13-40' })).toBeNull();
		expect(parseVacation({ start: '2026-07-01', back: 'soon' })).toBeNull();
		expect(parseVacation({ start: '2026-07-01', back: '2026-07-01' })).toBeNull();
		expect(parseVacation({ start: '2026-07-05', back: '2026-07-01' })).toBeNull();
	});
});

describe('isVacationDay', () => {
	const v = { start: '2026-07-01', back: '2026-07-08' };
	it('includes start, excludes the day back', () => {
		expect(isVacationDay(v, '2026-06-30')).toBe(false);
		expect(isVacationDay(v, '2026-07-01')).toBe(true);
		expect(isVacationDay(v, '2026-07-07')).toBe(true);
		expect(isVacationDay(v, '2026-07-08')).toBe(false);
	});
	it('is open-ended without a back date, and false without a vacation', () => {
		expect(isVacationDay({ start: '2026-07-01', back: null }, '2030-01-01')).toBe(true);
		expect(isVacationDay(null, '2026-07-01')).toBe(false);
	});
});
