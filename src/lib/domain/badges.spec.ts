import { describe, expect, it } from 'vitest';
import {
	BADGES,
	badgeDecision,
	bestWeekCount,
	earnedIds,
	longestRun,
	paidStreakDays,
	stickerBook,
	weekStart,
	type BadgeFacts
} from './badges.js';

const none: BadgeFacts = {
	starJobsDone: 0,
	lifetimeStars: 0,
	longestStreak: 0,
	redemptions: 0,
	bestHabitWeek: 0
};

describe('catalog', () => {
	it('has unique ids and a hint and description for every badge', () => {
		expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
		for (const b of BADGES) expect(b.hint && b.description && b.emoji && b.title).toBeTruthy();
	});

	it('earns nothing with no history', () => {
		expect(earnedIds(stickerBook(none))).toEqual([]);
	});

	it.each([
		[{ starJobsDone: 1 }, ['first-star-job']],
		[{ lifetimeStars: 10 }, ['stars-10']],
		[{ lifetimeStars: 100 }, ['stars-10', 'stars-50', 'stars-100']],
		[{ lifetimeStars: 500 }, ['stars-10', 'stars-50', 'stars-100', 'stars-500']],
		[{ longestStreak: 3 }, ['streak-3']],
		[{ longestStreak: 7 }, ['streak-3', 'streak-7']],
		[{ longestStreak: 30 }, ['streak-3', 'streak-7', 'streak-30']],
		[{ redemptions: 1 }, ['first-reward']],
		[{ bestHabitWeek: 7 }, ['habit-week']]
	] as [Partial<BadgeFacts>, string[]][])('judges %j', (facts, ids) => {
		expect(earnedIds(stickerBook({ ...none, ...facts }))).toEqual(ids);
	});

	it('stays unearned just below each threshold', () => {
		const book = stickerBook({
			starJobsDone: 0,
			lifetimeStars: 9,
			longestStreak: 2,
			redemptions: 0,
			bestHabitWeek: 6
		});
		expect(earnedIds(book)).toEqual([]);
		expect(book[0]).not.toHaveProperty('earned', undefined);
		expect(book[0]).not.toHaveProperty('earn');
	});
});

describe('history helpers', () => {
	it('finds the Monday of a week', () => {
		expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
		expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
		expect(weekStart('2026-10-14')).toBe('2026-10-12');
	});

	it('counts the busiest week', () => {
		expect(bestWeekCount([])).toBe(0);
		expect(bestWeekCount(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-18'])).toBe(3);
	});

	it('finds the longest run, skipping empty days and breaking on misses', () => {
		expect(longestRun([])).toBe(0);
		expect(
			longestRun(['complete', 'complete', 'none', 'complete', 'missed', 'complete', 'complete'])
		).toBe(3);
	});

	it('reads paid streaks from ledger refs', () => {
		expect(paidStreakDays([])).toBe(0);
		expect(paidStreakDays([null, 'bonus', 'streak:3:2026-01-01', 'streak:14:2026-02-01'])).toBe(14);
	});
});

describe('badgeDecision', () => {
	it('seeds silently on a first visit', () => {
		const d = badgeDecision(null, ['stars-10']);
		expect(d.celebrate).toEqual([]);
		expect(JSON.parse(d.store)).toEqual(['stars-10']);
	});

	it('celebrates each new badge exactly once', () => {
		const first = badgeDecision('[]', ['first-star-job']);
		expect(first.celebrate).toEqual(['first-star-job']);
		expect(badgeDecision(first.store, ['first-star-job']).celebrate).toEqual([]);
	});

	it('never forgets a badge it has seen', () => {
		const d = badgeDecision('["a","b"]', ['b', 'c']);
		expect(d.celebrate).toEqual(['c']);
		expect(JSON.parse(d.store)).toEqual(['a', 'b', 'c']);
	});

	it('treats junk as a first visit', () => {
		expect(badgeDecision('{oops', ['x']).celebrate).toEqual([]);
		expect(badgeDecision('{"a":1}', ['x']).celebrate).toEqual([]);
		expect(JSON.parse(badgeDecision('[1,"a"]', []).store)).toEqual(['a']);
	});
});
