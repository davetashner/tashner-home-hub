import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MILESTONES,
	addDays,
	computeStreak,
	dayOutcome,
	milestonesToAward,
	nextMilestone,
	parseMilestones,
	reachedMilestone,
	streakRef,
	type DayOutcome
} from './streaks.js';

const TODAY = '2026-03-10';
const outcomes = (map: Record<string, DayOutcome>) => (d: string) => map[d] ?? 'none';

describe('addDays', () => {
	it('crosses month and year ends', () => {
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});
});

describe('dayOutcome', () => {
	it('judges due vs approved', () => {
		expect(dayOutcome(0, 0)).toBe('none');
		expect(dayOutcome(2, 1)).toBe('missed');
		expect(dayOutcome(2, 2)).toBe('complete');
	});
});

describe('computeStreak', () => {
	it('is zero with nothing ever due', () => {
		expect(computeStreak(outcomes({}), TODAY)).toEqual({ days: 0, runStart: null });
	});

	it('counts an unbroken run ending today', () => {
		const o = outcomes({
			'2026-03-10': 'complete',
			'2026-03-09': 'complete',
			'2026-03-08': 'complete'
		});
		expect(computeStreak(o, TODAY)).toEqual({ days: 3, runStart: '2026-03-08' });
	});

	it('does not break on an unfinished today', () => {
		const o = outcomes({
			'2026-03-10': 'missed',
			'2026-03-09': 'complete',
			'2026-03-08': 'complete'
		});
		expect(computeStreak(o, TODAY)).toEqual({ days: 2, runStart: '2026-03-08' });
	});

	it('breaks on a missed past day', () => {
		const o = outcomes({
			'2026-03-09': 'complete',
			'2026-03-08': 'missed',
			'2026-03-07': 'complete'
		});
		expect(computeStreak(o, TODAY)).toEqual({ days: 1, runStart: '2026-03-09' });
	});

	it('skips days with nothing due without counting or breaking', () => {
		const o = outcomes({
			'2026-03-10': 'complete',
			'2026-03-08': 'complete',
			'2026-03-07': 'complete'
		});
		expect(computeStreak(o, TODAY)).toEqual({ days: 3, runStart: '2026-03-07' });
	});

	it('stops at the look-back limit', () => {
		expect(computeStreak(() => 'complete', TODAY, 5).days).toBe(5);
	});
});

describe('parseMilestones', () => {
	it('defaults for non-arrays and all-invalid lists', () => {
		expect(parseMilestones(null)).toEqual(DEFAULT_MILESTONES);
		expect(parseMilestones([{ days: 1, stars: 1 }, 'x', null])).toEqual(DEFAULT_MILESTONES);
	});
	it('an empty list turns bonuses off', () => {
		expect(parseMilestones([])).toEqual([]);
	});
	it('sorts, dedupes and drops bad entries', () => {
		expect(
			parseMilestones([
				{ days: 7, stars: 3 },
				{ days: 2, stars: 1 },
				{ days: 7, stars: 4 },
				{ days: 5.5, stars: 1 },
				{ days: 9, stars: 0 }
			])
		).toEqual([
			{ days: 2, stars: 1 },
			{ days: 7, stars: 4 }
		]);
	});
});

describe('milestonesToAward', () => {
	const streak = { days: 7, runStart: '2026-03-04' };
	it('awards every reached milestone not yet paid', () => {
		expect(milestonesToAward(streak, DEFAULT_MILESTONES, []).map((m) => m.days)).toEqual([3, 7]);
	});
	it('never pays twice for the same run', () => {
		const paid = [streakRef(3, '2026-03-04'), streakRef(7, '2026-03-04')];
		expect(milestonesToAward(streak, DEFAULT_MILESTONES, paid)).toEqual([]);
	});
	it('treats a run that began earlier through a late approval as the same run', () => {
		const paid = [streakRef(3, '2026-03-04'), null, 'bonus:other'];
		expect(
			milestonesToAward({ days: 8, runStart: '2026-03-03' }, DEFAULT_MILESTONES, paid).map(
				(m) => m.days
			)
		).toEqual([7]);
	});
	it('pays again for a new run after a broken streak', () => {
		const paid = [streakRef(3, '2026-02-01')];
		expect(
			milestonesToAward({ days: 3, runStart: '2026-03-08' }, DEFAULT_MILESTONES, paid).map(
				(m) => m.days
			)
		).toEqual([3]);
	});
	it('awards nothing without a run', () => {
		expect(milestonesToAward({ days: 0, runStart: null }, DEFAULT_MILESTONES, [])).toEqual([]);
	});
});

describe('nextMilestone / reachedMilestone', () => {
	it('finds the next target', () => {
		expect(nextMilestone(0, DEFAULT_MILESTONES)?.days).toBe(3);
		expect(nextMilestone(7, DEFAULT_MILESTONES)?.days).toBe(14);
		expect(nextMilestone(30, DEFAULT_MILESTONES)).toBeNull();
	});
	it('detects only growth onto a milestone', () => {
		expect(reachedMilestone(2, 3, DEFAULT_MILESTONES)?.days).toBe(3);
		expect(reachedMilestone(undefined, 3, DEFAULT_MILESTONES)).toBeNull();
		expect(reachedMilestone(3, 3, DEFAULT_MILESTONES)).toBeNull();
		expect(reachedMilestone(3, 4, DEFAULT_MILESTONES)).toBeNull();
	});
});
