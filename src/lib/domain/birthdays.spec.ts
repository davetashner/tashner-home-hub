import { describe, expect, it } from 'vitest';
import {
	birthdayDates,
	isBirthday,
	isRealDate,
	MAX_BIRTHDAYS,
	parseBirthdays,
	resolveBirthdays
} from './birthdays.js';

// Synthetic dates only: the real ones live in the runtime database.
describe('isRealDate', () => {
	it('allows real dates, Feb 29 included', () => {
		expect(isRealDate(3, 14)).toBe(true);
		expect(isRealDate(2, 29)).toBe(true);
		expect(isRealDate(12, 31)).toBe(true);
	});
	it('rejects impossible and non-integer dates', () => {
		for (const [m, d] of [
			[2, 30],
			[4, 31],
			[13, 1],
			[0, 1],
			[1, 0],
			[1.5, 2],
			['3', 14]
		]) {
			expect(isRealDate(m, d)).toBe(false);
		}
	});
});

describe('parseBirthdays', () => {
	it('sorts into calendar order and trims labels', () => {
		expect(
			parseBirthdays({
				birthdays: [
					{ month: 9, day: 2, label: ' Kid B ' },
					{ month: 3, day: 14 }
				]
			})
		).toEqual([
			{ month: 3, day: 14 },
			{ month: 9, day: 2, label: 'Kid B' }
		]);
	});
	it('accepts an empty list and Feb 29', () => {
		expect(parseBirthdays({ birthdays: [] })).toEqual([]);
		expect(parseBirthdays({ birthdays: [{ month: 2, day: 29 }] })).toEqual([{ month: 2, day: 29 }]);
	});
	it('rejects bad shapes, dates, repeats, long labels and too many', () => {
		expect(parseBirthdays({})).toMatch(/list/);
		expect(parseBirthdays({ birthdays: [{ month: 2, day: 30 }] })).toMatch(/real/);
		expect(parseBirthdays({ birthdays: [null] })).toMatch(/real/);
		expect(
			parseBirthdays({
				birthdays: [
					{ month: 3, day: 14 },
					{ month: 3, day: 14 }
				]
			})
		).toMatch(/once/);
		expect(parseBirthdays({ birthdays: [{ month: 3, day: 14, label: 'x'.repeat(41) }] })).toMatch(
			/label/
		);
		expect(parseBirthdays({ birthdays: [{ month: 3, day: 14, label: 7 }] })).toMatch(/label/);
		const many = Array.from({ length: MAX_BIRTHDAYS + 1 }, (_, i) => ({
			month: 1 + (i % 12),
			day: 1 + Math.floor(i / 12)
		}));
		expect(parseBirthdays({ birthdays: many })).toMatch(/at most/);
	});
});

describe('resolveBirthdays', () => {
	it('drops bad and repeated entries instead of failing', () => {
		expect(
			resolveBirthdays([
				{ month: 3, day: 14 },
				{ month: 3, day: 14 },
				{ month: 2, day: 31 },
				'nope'
			])
		).toEqual([{ month: 3, day: 14 }]);
		expect(resolveBirthdays(undefined)).toEqual([]);
	});
});

describe('birthdayDates', () => {
	it('strips labels for the wall', () => {
		expect(birthdayDates([{ month: 3, day: 14, label: 'Kid A' }])).toEqual([{ month: 3, day: 14 }]);
	});
});

describe('isBirthday', () => {
	const list = [{ month: 3, day: 14 }];
	it('matches the month and day in any year', () => {
		expect(isBirthday(list, 3, 14, 2030)).toBe(true);
		expect(isBirthday(list, 3, 14, 2031)).toBe(true);
		expect(isBirthday(list, 3, 13, 2030)).toBe(false);
		expect(isBirthday(list, 3, 15, 2030)).toBe(false);
	});
	it('shows a Feb 29 birthday on Feb 28 in a year without one', () => {
		const leapDay = [{ month: 2, day: 29 }];
		expect(isBirthday(leapDay, 2, 28, 2030)).toBe(true);
		expect(isBirthday(leapDay, 2, 28, 2100)).toBe(true); // 2100 is not a leap year
		expect(isBirthday(leapDay, 2, 27, 2030)).toBe(false);
		expect(isBirthday(leapDay, 3, 1, 2030)).toBe(false);
	});
	it('shows a Feb 29 birthday on Feb 29 only in a leap year', () => {
		const leapDay = [{ month: 2, day: 29 }];
		expect(isBirthday(leapDay, 2, 29, 2032)).toBe(true);
		expect(isBirthday(leapDay, 2, 28, 2032)).toBe(false);
		expect(isBirthday(leapDay, 2, 28, 2000)).toBe(false); // 2000 is a leap year
	});
	it('does not move a Feb 28 birthday', () => {
		expect(isBirthday([{ month: 2, day: 28 }], 2, 28, 2030)).toBe(true);
		expect(isBirthday([{ month: 2, day: 28 }], 2, 29, 2032)).toBe(false);
	});
});
