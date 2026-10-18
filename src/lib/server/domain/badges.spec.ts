import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { approveCompletion, completeChore, createChore } from './ledger.js';
import { redeemReward } from './redemptions.js';
import { badgeFacts, stickerBookFor } from './badges.js';
import { earnedIds } from '#lib/domain/badges.js';
import { addDays } from '#lib/domain/streaks.js';

const DAY0 = '2026-03-01';
const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
const clock = (date: string) => ({ now: at(date), timeZone: 'UTC' });
const DAILY = `DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY`;
let db: Db;

function chore(kind: 'habit' | 'star_job', stars = 1, memberIds = ['kid']) {
	return createChore(db, {
		title: `${kind} ${Math.random()}`,
		kind,
		stars,
		memberIds,
		schedule: DAILY,
		requiresApproval: false
	}).id;
}
const finish = (choreId: string, date: string) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: at(date) }).completion;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values({ id: 'kid', name: 'Kid A', role: 'child', color: 'blue' })
		.run();
	db.insert(schema.members)
		.values({ id: 'adult', name: 'Parent One', role: 'adult', color: 'red' })
		.run();
});

describe('badgeFacts', () => {
	it('starts empty', () => {
		expect(badgeFacts(db, 'kid', DAY0)).toEqual({
			starJobsDone: 0,
			lifetimeStars: 0,
			longestStreak: 0,
			redemptions: 0,
			bestHabitWeek: 0
		});
	});

	it('earns the first Star Job and its stars, but not while pending approval', () => {
		const job = createChore(db, {
			title: 'Wash car',
			stars: 4,
			memberIds: ['kid'],
			schedule: DAILY,
			requiresApproval: true
		}).id;
		const c = finish(job, DAY0);
		expect(badgeFacts(db, 'kid', DAY0).starJobsDone).toBe(0);
		approveCompletion(db, c.id);
		const f = badgeFacts(db, 'kid', DAY0);
		expect(f.starJobsDone).toBe(1);
		expect(f.lifetimeStars).toBe(4);
	});

	it('counts stars earned, not net of spending, and ignores corrections', () => {
		const job = chore('star_job', 20);
		finish(job, DAY0);
		db.insert(schema.rewards).values({ id: 'r', title: 'Movie', cost: 15 }).run();
		redeemReward(db, { memberId: 'kid', rewardId: 'r', approvedBy: 'adult', now: at(DAY0) });
		db.insert(schema.starTransactions)
			.values({ id: 'adj', memberId: 'kid', delta: 50, reason: 'adjustment', status: 'approved' })
			.run();
		const f = badgeFacts(db, 'kid', DAY0);
		expect(f.lifetimeStars).toBe(20);
		expect(f.redemptions).toBe(1);
		expect(earnedIds(stickerBookFor(db, 'kid', clock(DAY0)))).toContain('first-reward');
	});

	it('keeps a streak badge after the streak breaks', () => {
		const habit = chore('habit');
		for (let i = 0; i < 3; i++) finish(habit, addDays(DAY0, i));
		// day 4 missed, day 5 done: the live streak is 1, the best was 3
		finish(habit, addDays(DAY0, 4));
		expect(badgeFacts(db, 'kid', addDays(DAY0, 4)).longestStreak).toBe(3);
	});

	it('does not let an open today, or a vacation, break a run', () => {
		const habit = chore('habit');
		finish(habit, DAY0);
		finish(habit, addDays(DAY0, 1));
		expect(badgeFacts(db, 'kid', addDays(DAY0, 2)).longestStreak).toBe(2);
		db.insert(schema.settings)
			.values({
				key: 'streaks.vacation',
				value: JSON.stringify({ start: addDays(DAY0, 2), back: addDays(DAY0, 4) })
			})
			.run();
		finish(habit, addDays(DAY0, 4));
		expect(badgeFacts(db, 'kid', addDays(DAY0, 4)).longestStreak).toBe(3);
	});

	it('counts the paid streak milestones that outlive the history window', () => {
		db.insert(schema.starTransactions)
			.values({
				id: 's',
				memberId: 'kid',
				delta: 25,
				reason: 'streak',
				refId: 'streak:30:2024-01-01',
				status: 'approved'
			})
			.run();
		const f = badgeFacts(db, 'kid', DAY0);
		expect(f.longestStreak).toBe(30);
		expect(f.lifetimeStars).toBe(25);
	});

	it('finds seven habits in one week', () => {
		const habits = [chore('habit'), chore('habit')];
		// Mon 2026-03-02 .. Sun 2026-03-08: four days of one habit, three of another
		for (let i = 1; i <= 4; i++) finish(habits[0], addDays(DAY0, i));
		for (let i = 4; i <= 6; i++) finish(habits[1], addDays(DAY0, i));
		expect(badgeFacts(db, 'kid', '2026-03-08').bestHabitWeek).toBe(7);
	});

	it('ignores other kids and unapproved habits', () => {
		const habit = chore('habit', 1, ['kid', 'adult']);
		completeChore(db, { choreId: habit, memberId: 'adult', date: DAY0, now: at(DAY0) });
		expect(badgeFacts(db, 'kid', DAY0).bestHabitWeek).toBe(0);
	});
});
