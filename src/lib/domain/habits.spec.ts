import { describe, expect, it } from 'vitest';
import { dayComplete, habitDayRef, tally, weekSoFar } from './habits.js';

describe('habits', () => {
	it('earns the day only when something was due and all of it is done', () => {
		expect(dayComplete({ due: 3, done: 3 })).toBe(true);
		expect(dayComplete({ due: 3, done: 2 })).toBe(false);
		expect(dayComplete({ due: 0, done: 0 })).toBe(false);
	});

	it('keys one star per member per day', () => {
		expect(habitDayRef('kid', '2026-10-17')).toBe('habits-day:kid:2026-10-17');
	});

	it('runs the week from Monday to the given day', () => {
		expect(weekSoFar('2026-10-12')).toEqual(['2026-10-12']); // a Monday
		expect(weekSoFar('2026-10-18')).toEqual([
			'2026-10-12',
			'2026-10-13',
			'2026-10-14',
			'2026-10-15',
			'2026-10-16',
			'2026-10-17',
			'2026-10-18'
		]);
		expect(weekSoFar('2026-11-03')).toEqual(['2026-11-02', '2026-11-03']); // across a month
	});

	it('sums days, never counting more done than due', () => {
		expect(
			tally([
				{ due: 4, done: 4 },
				{ due: 4, done: 1 },
				{ due: 2, done: 5 }
			])
		).toEqual({ due: 10, done: 7 });
		expect(tally([])).toEqual({ due: 0, done: 0 });
	});
});
