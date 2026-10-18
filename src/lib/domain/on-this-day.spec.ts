import { describe, expect, it } from 'vitest';
import {
	arrangePlaylist,
	calendarDay,
	isOnThisDayMode,
	MIN_ONLY_MATCHES,
	onThisDayCaption,
	onThisDayMatch,
	weave,
	type CalendarDay
} from './on-this-day.js';

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 14, 30);
const day = (year: number, month: number, d: number): CalendarDay => ({ year, month, day: d });

describe('mode', () => {
	it('knows the three modes', () => {
		expect(['off', 'favor', 'only'].every(isOnThisDayMode)).toBe(true);
		expect(isOnThisDayMode('sometimes')).toBe(false);
		expect(isOnThisDayMode(3)).toBe(false);
	});
});

describe('calendarDay', () => {
	it('reads the local date', () => {
		expect(calendarDay(new Date(2026, 9, 18, 23, 59))).toEqual(day(2026, 10, 18));
	});
});

describe('onThisDayMatch', () => {
	const today = day(2026, 10, 18);

	it('matches the same day in a past year', () => {
		expect(onThisDayMatch(at(2023, 10, 18), today)).toEqual({ yearsAgo: 3, daysAway: 0 });
	});

	it('matches three days either side but not four', () => {
		expect(onThisDayMatch(at(2023, 10, 15), today)?.daysAway).toBe(3);
		expect(onThisDayMatch(at(2023, 10, 21), today)?.daysAway).toBe(3);
		expect(onThisDayMatch(at(2023, 10, 14), today)).toBeNull();
		expect(onThisDayMatch(at(2023, 10, 22), today)).toBeNull();
	});

	it('skips this year, the future, and missing dates', () => {
		expect(onThisDayMatch(at(2026, 10, 17), today)).toBeNull();
		expect(onThisDayMatch(at(2027, 10, 18), today)).toBeNull();
		expect(onThisDayMatch(null, today)).toBeNull();
		expect(onThisDayMatch(undefined, today)).toBeNull();
		expect(onThisDayMatch(Number.NaN, today)).toBeNull();
	});

	it('runs across the year end in both directions', () => {
		// Jan 1, 2020 is 2 days after Dec 30, 2025's next anniversary: matches as 6 years ago.
		expect(onThisDayMatch(at(2020, 1, 1), day(2025, 12, 30))).toEqual({
			yearsAgo: 6,
			daysAway: 2
		});
		// Dec 30, 2019 seen from Jan 2, 2026: the anniversary is Dec 30, 2025.
		expect(onThisDayMatch(at(2019, 12, 30), day(2026, 1, 2))).toEqual({
			yearsAgo: 6,
			daysAway: 3
		});
		// A photo from last December is not "years ago" for early January.
		expect(onThisDayMatch(at(2025, 12, 31), day(2026, 1, 1))).toBeNull();
	});

	it('handles leap days', () => {
		// Feb 29 photo, common-year today: anniversary is Feb 28.
		expect(onThisDayMatch(at(2020, 2, 29), day(2026, 3, 1))).toEqual({ yearsAgo: 6, daysAway: 1 });
		expect(onThisDayMatch(at(2020, 2, 29), day(2026, 2, 28))).toEqual({
			yearsAgo: 6,
			daysAway: 0
		});
		// Leap year today: Feb 29 is its own day; Mar 1 photo is a day later.
		expect(onThisDayMatch(at(2019, 3, 1), day(2024, 2, 29))).toEqual({ yearsAgo: 5, daysAway: 1 });
		expect(onThisDayMatch(at(2020, 2, 29), day(2028, 2, 29))?.daysAway).toBe(0);
		// Feb 28 to Mar 1 is one day in a common year, two in a leap year.
		expect(onThisDayMatch(at(2019, 2, 28), day(2026, 3, 1), 1)?.daysAway).toBe(1);
		expect(onThisDayMatch(at(2019, 2, 28), day(2024, 3, 1), 1)).toBeNull();
	});

	it('honours a custom window', () => {
		expect(onThisDayMatch(at(2023, 10, 20), today, 1)).toBeNull();
		expect(onThisDayMatch(at(2023, 10, 20), today, 2)?.daysAway).toBe(2);
	});
});

describe('onThisDayCaption', () => {
	const today = day(2026, 10, 18);
	it('words the distance', () => {
		expect(onThisDayCaption(at(2023, 10, 18), today)).toBe('3 years ago today');
		expect(onThisDayCaption(at(2025, 10, 18), today)).toBe('1 year ago today');
		expect(onThisDayCaption(at(2023, 10, 20), today)).toBe('3 years ago this week');
		expect(onThisDayCaption(at(2023, 6, 1), today)).toBeNull();
	});
});

describe('weave', () => {
	it('returns the other list when there are no matches or the reverse', () => {
		expect(weave<string | number>([], [1, 2])).toEqual([1, 2]);
		expect(weave<string | number>(['a'], [])).toEqual(['a']);
	});

	it('places few matches once each, every third slide, then the rest', () => {
		expect(weave<string | number>(['a', 'b'], [1, 2, 3, 4, 5, 6])).toEqual([
			1,
			2,
			'a',
			3,
			4,
			'b',
			5,
			6
		]);
		expect(weave<string | number>(['a', 'b', 'c'], [1, 2])).toEqual([1, 2, 'a', 'b', 'c']);
	});

	it('cycles enough matches to hold one in three', () => {
		const matches = ['a', 'b', 'c', 'd', 'e'];
		const out = weave<string | number>(
			matches,
			Array.from({ length: 20 }, (_, i) => i)
		);
		expect(out).toHaveLength(29);
		expect(out.filter((x) => typeof x === 'string')).toHaveLength(9);
		expect(out.map((x, i) => (typeof x === 'string' ? i % 3 : -1)).filter((i) => i >= 0)).toEqual(
			Array(9).fill(2)
		);
		// A photo returns no sooner than a full cycle of matches later.
		expect(out.indexOf('a', out.indexOf('a') + 1) - out.indexOf('a')).toBe(15);
	});
});

describe('arrangePlaylist', () => {
	const today = day(2026, 10, 18);
	const reverse = <T>(xs: readonly T[]) => [...xs].reverse();
	const photo = (id: string, d: number | null) => ({
		id,
		takenAt: d === null ? null : at(2023, 10, d)
	});
	const near = (n: number) => Array.from({ length: n }, (_, i) => photo(`m${i}`, 18));
	const far = (n: number) => Array.from({ length: n }, (_, i) => photo(`o${i}`, i % 2 ? null : 1));

	it('off just shuffles', () => {
		const all = [...near(2), ...far(2)];
		expect(arrangePlaylist(all, 'off', today, reverse)).toEqual(reverse(all));
	});

	it('favor weaves matches in without dropping anyone', () => {
		const all = [...far(6), ...near(2)];
		const ids = arrangePlaylist(all, 'favor', today, (x) => [...x]).map((p) => p.id);
		expect(ids).toEqual(['o0', 'o1', 'm0', 'o2', 'o3', 'm1', 'o4', 'o5']);
	});

	it('only keeps matches when there are enough', () => {
		const all = [...far(5), ...near(MIN_ONLY_MATCHES)];
		const out = arrangePlaylist(all, 'only', today, (x) => [...x]);
		expect(out).toHaveLength(MIN_ONLY_MATCHES);
		expect(out.every((p) => p.id.startsWith('m'))).toBe(true);
	});

	it('only falls back to every photo when too few match', () => {
		const all = [...far(5), ...near(MIN_ONLY_MATCHES - 1)];
		expect(arrangePlaylist(all, 'only', today, (x) => [...x])).toHaveLength(all.length);
	});
});
