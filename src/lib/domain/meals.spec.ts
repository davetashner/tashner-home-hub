import { describe, expect, it } from 'vitest';
import {
	cleanMealText,
	currentWeek,
	daySummary,
	isMealSlot,
	isWeekParam,
	mealMap,
	mondayOf,
	shiftWeek,
	weekDays
} from './meals.js';

describe('meal validation', () => {
	it('knows the four slots', () => {
		expect(isMealSlot('dinner')).toBe(true);
		expect(isMealSlot('brunch')).toBe(false);
		expect(isMealSlot(3)).toBe(false);
	});
	it('trims, collapses spaces and bounds the text', () => {
		expect(cleanMealText('  Taco   night ')).toBe('Taco night');
		expect(cleanMealText('   ')).toBeNull();
		expect(cleanMealText(7)).toBeNull();
		expect(cleanMealText('a'.repeat(100))).toHaveLength(100);
		expect(cleanMealText('a'.repeat(101))).toBeNull();
	});
	it('accepts only real days as a week', () => {
		expect(isWeekParam('2026-10-17')).toBe(true);
		expect(isWeekParam('2026-02-30')).toBe(false);
		expect(isWeekParam('x')).toBe(false);
	});
});

describe('week math', () => {
	it('snaps any day to its Monday', () => {
		expect(mondayOf('2026-10-17')).toBe('2026-10-12'); // Saturday
		expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday belongs to the week before
		expect(mondayOf('2026-10-12')).toBe('2026-10-12');
	});
	it('lists seven days, Monday to Sunday', () => {
		const d = weekDays('2026-10-15');
		expect(d).toHaveLength(7);
		expect(d[0]).toBe('2026-10-12');
		expect(d[6]).toBe('2026-10-18');
	});
	it('steps by whole weeks across a year end', () => {
		expect(shiftWeek('2026-12-30', 1)).toBe('2027-01-04');
		expect(shiftWeek('2027-01-01', -1)).toBe('2026-12-21');
	});
	it('keeps seven distinct days across the US spring-forward week', () => {
		const d = weekDays('2026-03-08'); // clocks change Sunday 8 March
		expect(d).toEqual([
			'2026-03-02',
			'2026-03-03',
			'2026-03-04',
			'2026-03-05',
			'2026-03-06',
			'2026-03-07',
			'2026-03-08'
		]);
		expect(weekDays('2026-11-01')[0]).toBe('2026-10-26'); // fall-back Sunday
	});
	it('reads "this week" in the household zone, not UTC', () => {
		const sundayLateChicago = Date.UTC(2026, 2, 9, 3, 30); // Sun 8 Mar 22:30 CDT
		expect(currentWeek(sundayLateChicago, 'America/Chicago')).toBe('2026-03-02');
		expect(currentWeek(sundayLateChicago, 'UTC')).toBe('2026-03-09');
	});
});

describe('day summary', () => {
	const map = mealMap([
		{ date: '2026-10-12', meal: 'lunch', title: 'Soup' },
		{ date: '2026-10-12', meal: 'dinner', title: 'Tacos' },
		{ date: '2026-10-13', meal: 'snack', title: 'Apples' }
	]);
	it('prefers dinner, falls back to other slots, else null', () => {
		expect(daySummary(map, '2026-10-12')).toBe('Tacos');
		expect(daySummary(map, '2026-10-13')).toBe('Apples');
		expect(daySummary(map, '2026-10-14')).toBeNull();
	});
});
