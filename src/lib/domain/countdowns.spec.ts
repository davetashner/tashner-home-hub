import { describe, expect, it } from 'vitest';
import {
	countdownLabel,
	dayIn,
	dayNumber,
	daysUntil,
	isCalendarDate,
	upcomingCountdowns
} from './countdowns';

const c = (id: string, targetDate: string, title = id) => ({ id, title, targetDate, icon: null });

describe('dates', () => {
	it('accepts real days and rejects the rest', () => {
		expect(isCalendarDate('2028-02-29')).toBe(true);
		expect(isCalendarDate('2027-02-29')).toBe(false);
		expect(isCalendarDate('2026-13-01')).toBe(false);
		expect(isCalendarDate('2026-1-1')).toBe(false);
		expect(isCalendarDate(20260101)).toBe(false);
		expect(dayNumber('nope')).toBeNull();
	});
	it('counts calendar days across months, years and leap days', () => {
		expect(daysUntil('2026-10-16', '2026-10-16')).toBe(0);
		expect(daysUntil('2026-10-28', '2026-10-16')).toBe(12);
		expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
		expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2);
		expect(daysUntil('2026-10-15', '2026-10-16')).toBe(-1);
		expect(daysUntil('bad', '2026-10-16')).toBeNull();
		expect(daysUntil('2026-10-16', 'bad')).toBeNull();
	});
	it('is not thrown by DST changes', () => {
		expect(daysUntil('2026-11-02', '2026-10-31')).toBe(2);
		expect(daysUntil('2026-03-09', '2026-03-07')).toBe(2);
	});
});

describe('dayIn', () => {
	it('uses the household zone, not the instant in UTC', () => {
		const t = Date.UTC(2026, 9, 17, 2, 30); // 02:30 UTC
		expect(dayIn(t, 'UTC')).toBe('2026-10-17');
		expect(dayIn(t, 'America/Chicago')).toBe('2026-10-16');
		expect(dayIn(t, 'Asia/Tokyo')).toBe('2026-10-17');
	});
});

describe('countdownLabel', () => {
	it('handles the special cases', () => {
		expect(countdownLabel(0)).toBe('Today');
		expect(countdownLabel(1)).toBe('Tomorrow');
		expect(countdownLabel(2)).toBe('2 days');
		expect(countdownLabel(365)).toBe('365 days');
	});
});

describe('upcomingCountdowns', () => {
	const today = '2026-10-16';
	it('drops expired ones, sorts soonest first and caps the list', () => {
		const list = [
			c('far', '2027-01-01'),
			c('past', '2026-10-15'),
			c('tomorrow', '2026-10-17'),
			c('today', '2026-10-16'),
			c('mid', '2026-11-01'),
			c('junk', 'nope')
		];
		const got = upcomingCountdowns(list, today);
		expect(got.map((g) => g.id)).toEqual(['today', 'tomorrow', 'mid']);
		expect(got.map((g) => g.label)).toEqual(['Today', 'Tomorrow', '16 days']);
		expect(upcomingCountdowns(list, today, 10).map((g) => g.id)).toEqual([
			'today',
			'tomorrow',
			'mid',
			'far'
		]);
		expect(upcomingCountdowns(list, today, 0)).toEqual([]);
	});
	it('breaks ties by title', () => {
		const got = upcomingCountdowns(
			[c('b', '2026-10-20', 'Zoo'), c('a', '2026-10-20', 'Ant')],
			today
		);
		expect(got.map((g) => g.title)).toEqual(['Ant', 'Zoo']);
	});
	it('a countdown drops off once its day has passed', () => {
		const list = [c('x', '2026-10-16')];
		expect(upcomingCountdowns(list, '2026-10-16')).toHaveLength(1);
		expect(upcomingCountdowns(list, '2026-10-17')).toHaveLength(0);
	});
});
