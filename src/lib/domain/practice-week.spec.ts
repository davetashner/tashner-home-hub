import { describe, expect, it } from 'vitest';
import { buildWeek, isDate, shiftWeeks, weekDates, weekLine } from './practice-week.js';

describe('weekDates', () => {
	it('runs Monday to Sunday for any day in the week', () => {
		const w = weekDates('2026-10-28'); // a Wednesday
		expect(w[0]).toBe('2026-10-26');
		expect(w[6]).toBe('2026-11-01');
		expect(weekDates('2026-10-26')).toEqual(w);
		expect(weekDates('2026-11-01')).toEqual(w);
	});
	it('crosses a year end', () => {
		expect(weekDates('2026-12-31')).toContain('2027-01-03');
	});
});

describe('shiftWeeks and isDate', () => {
	it('moves whole weeks', () => {
		expect(shiftWeeks('2026-10-28', -1)).toBe('2026-10-21');
		expect(shiftWeeks('2026-10-28', 1)).toBe('2026-11-04');
	});
	it('accepts only real dates', () => {
		expect(isDate('2026-10-28')).toBe(true);
		expect(isDate('2026-02-30')).toBe(false);
		expect(isDate('nope')).toBe(false);
		expect(isDate(5)).toBe(false);
	});
});

describe('buildWeek', () => {
	const logs = [
		{ date: '2026-10-26', activityId: 'read', minutes: 15, stars: 1 },
		{ date: '2026-10-26', activityId: 'piano', minutes: 20, stars: 1 },
		{ date: '2026-10-28', activityId: 'read', minutes: 30, stars: 2 },
		{ date: '2026-10-19', activityId: 'read', minutes: 99, stars: 9 }
	];
	it('sums per day and activity, ignores other weeks', () => {
		const w = buildWeek(logs, '2026-10-28', '2026-10-28');
		expect(w.weekStart).toBe('2026-10-26');
		expect(w.days.map((d) => d.minutes)).toEqual([35, 0, 30, 0, 0, 0, 0]);
		expect(w.days[2]!.isToday).toBe(true);
		expect(w.days[0]!.byActivity).toEqual({ read: 15, piano: 20 });
		expect(w.totalMinutes).toBe(65);
		expect(w.stars).toBe(4);
		expect(w.activities).toEqual([
			{ activityId: 'read', minutes: 45 },
			{ activityId: 'piano', minutes: 20 }
		]);
	});
	it('is empty and has no today in another week', () => {
		const w = buildWeek([], '2026-10-14', '2026-10-28');
		expect(w.totalMinutes).toBe(0);
		expect(w.days.some((d) => d.isToday)).toBe(false);
		expect(w.activities).toEqual([]);
	});
});

describe('weekLine', () => {
	it('words the total', () => {
		expect(weekLine(0, 0)).toBe('No reading yet this week. Log some!');
		expect(weekLine(95, 6)).toBe('95 minutes this week, 6 stars');
		expect(weekLine(1, 1)).toBe('1 minute this week, 1 star');
	});
});
