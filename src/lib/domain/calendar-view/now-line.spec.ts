import { describe, expect, it } from 'vitest';
import type { CalEvent } from './layout.js';
import { agendaNowIndex, minutesIntoDay, nowLineMinute } from './now-line.js';
import { zonedMs } from './zone.js';

const NY = 'America/New_York';
const hours = { from: 7, to: 21 };

describe('minutesIntoDay', () => {
	it('is wall-clock minutes in the given zone', () => {
		expect(minutesIntoDay(zonedMs('2026-10-16', 15 * 60 + 30, NY), '2026-10-16', NY)).toBe(930);
	});

	it('uses the zone, not UTC', () => {
		const t = Date.UTC(2026, 9, 16, 2, 0); // 22:00 on the 15th in New York
		expect(minutesIntoDay(t, '2026-10-15', NY)).toBe(22 * 60);
		expect(minutesIntoDay(t, '2026-10-16', NY)).toBe(-2 * 60);
	});

	it('keeps wall-clock alignment on a DST day', () => {
		// 2026-11-01 25h day in New York: 10:00 wall time is 11 elapsed hours after midnight.
		expect(minutesIntoDay(zonedMs('2026-11-01', 600, NY), '2026-11-01', NY)).toBe(600);
	});

	it('keeps fractional minutes', () => {
		expect(minutesIntoDay(zonedMs('2026-10-16', 600, NY) + 30_000, '2026-10-16', NY)).toBe(600.5);
	});
});

describe('nowLineMinute', () => {
	const at = (min: number) => zonedMs('2026-10-16', min, NY);
	it('returns the minute for today inside the visible hours', () => {
		expect(nowLineMinute(at(720), '2026-10-16', '2026-10-16', NY, hours)).toBe(720);
		expect(nowLineMinute(at(420), '2026-10-16', '2026-10-16', NY, hours)).toBe(420);
		expect(nowLineMinute(at(1260), '2026-10-16', '2026-10-16', NY, hours)).toBe(1260);
	});
	it('is null for other days and outside the visible hours', () => {
		expect(nowLineMinute(at(720), '2026-10-17', '2026-10-16', NY, hours)).toBeNull();
		expect(nowLineMinute(at(419), '2026-10-16', '2026-10-16', NY, hours)).toBeNull();
		expect(nowLineMinute(at(1261), '2026-10-16', '2026-10-16', NY, hours)).toBeNull();
	});
});

describe('agendaNowIndex', () => {
	const ev = (id: string, startsAt: number, allDay = false): CalEvent => ({
		id,
		title: id,
		startsAt,
		endsAt: startsAt + 3_600_000,
		allDay,
		location: null,
		notes: null,
		members: []
	});
	it('goes before the first event that has not started', () => {
		const list = [ev('a', 100), ev('b', 200), ev('c', 300)];
		expect(agendaNowIndex(list, 250)).toBe(2);
		expect(agendaNowIndex(list, 50)).toBe(0);
	});
	it('goes last when everything has started, and ignores all-day events', () => {
		const list = [ev('day', 1000, true), ev('a', 100)];
		expect(agendaNowIndex(list, 500)).toBe(2);
		expect(agendaNowIndex([ev('day', 1000, true)], 500)).toBe(1);
		expect(agendaNowIndex([], 500)).toBe(0);
	});
});
