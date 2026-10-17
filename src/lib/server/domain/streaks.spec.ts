import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { approveCompletion, completeChore, createChore, undoCompletion } from './ledger.js';
import { starBalance } from './stars.js';
import {
	awardForCompletion,
	awardStreakMilestones,
	streakMilestones,
	streakSummary
} from './streaks.js';
import { addDays } from '#lib/domain/streaks.js';

const TZ = 'UTC';
const DAY0 = '2026-03-01';
const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
let db: Db;
let choreId: string;

function setup(requiresApproval = false) {
	db = openDb(':memory:');
	db.insert(schema.members).values({ id: 'kid', name: 'Kid', role: 'child', color: 'blue' }).run();
	db.insert(schema.members).values({ id: 'kid2', name: 'Kid2', role: 'child', color: 'red' }).run();
	choreId = createChore(db, {
		title: 'Dishes',
		memberIds: ['kid'],
		schedule: `DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY`,
		requiresApproval
	}).id;
}
const finish = (date: string, memberId = 'kid') =>
	completeChore(db, { choreId, memberId, date, now: at(date) }).completion;
const clock = (date: string) => ({ now: at(date), timeZone: TZ });

beforeEach(() => setup());

describe('streakSummary', () => {
	it('counts consecutive approved days', () => {
		for (let i = 0; i < 3; i++) finish(addDays(DAY0, i));
		const s = streakSummary(db, 'kid', clock('2026-03-03'));
		expect(s.days).toBe(3);
		expect(s.next?.days).toBe(7);
	});

	it('does not count pending completions until approved', () => {
		setup(true);
		const c = finish(DAY0);
		expect(streakSummary(db, 'kid', clock(DAY0)).days).toBe(0);
		approveCompletion(db, c.id);
		expect(streakSummary(db, 'kid', clock(DAY0)).days).toBe(1);
	});

	it('breaks on a missed day and ignores other kids and archived chores', () => {
		finish('2026-03-01');
		finish('2026-03-03');
		expect(streakSummary(db, 'kid', clock('2026-03-03')).days).toBe(1);
		expect(streakSummary(db, 'kid2', clock('2026-03-03')).days).toBe(0);
		db.update(schema.chores).set({ archived: true }).run();
		expect(streakSummary(db, 'kid', clock('2026-03-03')).days).toBe(0);
	});

	it('uses the household zone when no clock zone is given', () => {
		expect(streakSummary(db, 'kid', { now: at('2026-03-03') }).days).toBe(0);
	});
});

describe('streakMilestones', () => {
	it('reads the saved list, falling back on corrupt JSON', () => {
		expect(streakMilestones(db).map((m) => m.days)).toEqual([3, 7, 14, 30]);
		db.insert(schema.settings)
			.values({ key: 'chores.streakMilestones', value: JSON.stringify([{ days: 2, stars: 9 }]) })
			.run();
		expect(streakMilestones(db)).toEqual([{ days: 2, stars: 9 }]);
		db.update(schema.settings).set({ value: '{nope' }).run();
		expect(streakMilestones(db).map((m) => m.days)).toEqual([3, 7, 14, 30]);
	});
});

describe('awardStreakMilestones', () => {
	it('pays the 3-day bonus once as a streak ledger row', () => {
		for (let i = 0; i < 3; i++) finish(addDays(DAY0, i));
		const c = clock('2026-03-03');
		expect(awardStreakMilestones(db, 'kid', c).map((m) => m.days)).toEqual([3]);
		expect(awardStreakMilestones(db, 'kid', c)).toEqual([]);
		const rows = db.select().from(schema.starTransactions).all();
		expect(rows.filter((r) => r.reason === 'streak')).toHaveLength(1);
		expect(starBalance(db, 'kid')).toBe(3 + 2);
	});

	it('does not pay again when a day is undone and redone', () => {
		const days = [0, 1, 2].map((i) => addDays(DAY0, i));
		const done = days.map((d) => finish(d));
		awardStreakMilestones(db, 'kid', clock('2026-03-03'));
		undoCompletion(db, done[2].id, { now: at('2026-03-03'), byAdult: true });
		finish('2026-03-03');
		expect(awardStreakMilestones(db, 'kid', clock('2026-03-03'))).toEqual([]);
		expect(starBalance(db, 'kid')).toBe(5);
	});

	it('pays a fresh run after a break', () => {
		for (let i = 0; i < 3; i++) finish(addDays(DAY0, i));
		awardStreakMilestones(db, 'kid', clock('2026-03-03'));
		for (let i = 4; i < 7; i++) finish(addDays(DAY0, i));
		expect(awardStreakMilestones(db, 'kid', clock('2026-03-07')).map((m) => m.days)).toEqual([3]);
	});

	it('ignores unknown members', () => {
		expect(awardStreakMilestones(db, 'ghost', clock(DAY0))).toEqual([]);
	});
});

describe('awardForCompletion', () => {
	it('pays on approval, not while pending', () => {
		setup(true);
		const cs = [0, 1, 2].map((i) => finish(addDays(DAY0, i)));
		expect(awardForCompletion(db, cs[2].id, clock('2026-03-03'))).toEqual([]);
		cs.forEach((c) => approveCompletion(db, c.id));
		expect(awardForCompletion(db, cs[2].id, clock('2026-03-03')).map((m) => m.days)).toEqual([3]);
		expect(awardForCompletion(db, 'missing')).toEqual([]);
	});
});
