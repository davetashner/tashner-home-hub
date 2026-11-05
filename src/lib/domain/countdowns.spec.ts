import { describe, expect, it } from 'vitest';
import {
	countdownDay,
	countdownLabel,
	dayIn,
	dayNumber,
	daysUntil,
	isCalendarDate,
	showsFrom,
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

describe('countdownDay', () => {
	it('reads as a short weekday and date', () => {
		expect(countdownDay('2026-11-26')).toBe('Thu, Nov 26');
		expect(countdownDay('nope')).toBe('nope');
	});
});

describe('showsFrom', () => {
	it('is 30 days before the target, across months and leap days', () => {
		expect(showsFrom('2027-01-14')).toBe('2026-12-15');
		expect(showsFrom('2028-03-15')).toBe('2028-02-14');
		expect(showsFrom('2026-12-01', 0)).toBe('2026-12-01');
		expect(showsFrom('nope')).toBeNull();
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
	it('drops expired ones, sorts soonest first and shows the two soonest', () => {
		const list = [
			c('edge', '2026-11-15'),
			c('past', '2026-10-15'),
			c('tomorrow', '2026-10-17'),
			c('today', '2026-10-16'),
			c('mid', '2026-11-01'),
			c('junk', 'nope')
		];
		const got = upcomingCountdowns(list, today);
		expect(got.map((g) => g.id)).toEqual(['today', 'tomorrow']);
		expect(got.map((g) => g.label)).toEqual(['Today', 'Tomorrow']);
		expect(upcomingCountdowns(list, today, 10).map((g) => g.id)).toEqual([
			'today',
			'tomorrow',
			'mid',
			'edge'
		]);
		expect(upcomingCountdowns(list, today, 0)).toEqual([]);
	});
	it('waits until a countdown is 30 days away', () => {
		const list = [c('trip', '2027-01-14')];
		expect(upcomingCountdowns(list, '2026-12-14')).toHaveLength(0);
		expect(upcomingCountdowns(list, '2026-12-15').map((g) => g.label)).toEqual(['30 days']);
		expect(upcomingCountdowns(list, '2026-12-14', 2, 31)).toHaveLength(1);
	});
	it('a far one takes a free spot once it is close enough', () => {
		const list = [c('a', '2026-10-20'), c('b', '2026-10-21'), c('c', '2026-11-10')];
		expect(upcomingCountdowns(list, today).map((g) => g.id)).toEqual(['a', 'b']);
		expect(upcomingCountdowns(list, '2026-10-21').map((g) => g.id)).toEqual(['b', 'c']);
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
