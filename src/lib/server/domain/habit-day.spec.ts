import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { archiveChore, createChore } from './chores.js';
import { habitDay, habitSummary, settleHabitStar } from './habit-day.js';
import { completeChore, undoCompletion } from './ledger.js';
import { completeRoutineStep, createRoutine } from './routines.js';
import { setHouseholdTimeZone } from '../household.js';
import { starBalance } from './stars.js';

const TZ = 'UTC';
const MON = '2026-10-12';
const TUE = '2026-10-13';
const clock = { now: Date.UTC(2026, 9, 12, 12), timeZone: TZ };
let db: Db;

const habit = (title: string, schedule?: { type: 'weekly'; start: string }) =>
	createChore(db, { title, kind: 'habit', memberIds: ['kid'], schedule }, clock).id;
const check = (choreId: string, date = MON) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: clock.now }).completion;
const habitRows = () =>
	db
		.select()
		.from(schema.starTransactions)
		.where(eq(schema.starTransactions.reason, 'habits_day'))
		.all();

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Test Kid', role: 'child', color: 'member-1' },
			{ id: 'sib', name: 'Test Sib', role: 'child', color: 'member-2' }
		])
		.run();
	setHouseholdTimeZone(db, TZ);
});

describe('habitDay', () => {
	it('counts due and done habits, ignoring Star Jobs, other members and archived habits', () => {
		const towels = habit('Hang up towels');
		const fish = habit('Feed the fish');
		const gone = habit('Old habit');
		archiveChore(db, gone, clock);
		createChore(db, { title: 'Wash window', memberIds: ['kid'] }, clock);
		createChore(db, { title: 'Sib habit', kind: 'habit', memberIds: ['sib'] }, clock);
		check(towels);
		expect(habitDay(db, 'kid', MON)).toEqual({ due: 2, done: 1 });
		check(fish);
		expect(habitDay(db, 'kid', MON)).toEqual({ due: 2, done: 2 });
	});

	it('only counts a habit on the days its schedule is due', () => {
		habit('Weekly tidy', { type: 'weekly', start: MON });
		expect(habitDay(db, 'kid', MON).due).toBe(1);
		expect(habitDay(db, 'kid', TUE).due).toBe(0);
	});

	it('counts each routine as one habit, done when every step is', () => {
		const r = createRoutine(db, {
			memberId: 'kid',
			name: 'Morning',
			steps: [
				{ label: 'Teeth', icon: 'toothbrush' },
				{ label: 'Dress', icon: 'shirt' }
			]
		});
		db.update(schema.routines)
			.set({ createdAt: Date.UTC(2026, 9, 1) })
			.run();
		completeRoutineStep(db, r.id, MON, 0);
		expect(habitDay(db, 'kid', MON)).toEqual({ due: 1, done: 0 });
		completeRoutineStep(db, r.id, MON, 1);
		expect(habitDay(db, 'kid', MON)).toEqual({ due: 1, done: 1 });
		// Not due before the routine existed.
		expect(habitDay(db, 'kid', '2026-09-30').due).toBe(0);
	});
});

describe('settleHabitStar', () => {
	it('pays one star when the last habit is done, and never twice', () => {
		const towels = habit('Hang up towels');
		const fish = habit('Feed the fish');
		check(towels);
		expect(settleHabitStar(db, 'kid', MON, clock.now)).toBe(false);
		expect(habitRows()).toEqual([]);
		check(fish);
		expect(settleHabitStar(db, 'kid', MON, clock.now)).toBe(true);
		settleHabitStar(db, 'kid', MON, clock.now);
		expect(habitRows()).toHaveLength(1);
		expect(starBalance(db, 'kid')).toBe(1);
	});

	it('withdraws the star when a habit is unchecked and restores it when redone', () => {
		const fish = habit('Feed the fish');
		const c = check(fish);
		settleHabitStar(db, 'kid', MON, clock.now);
		undoCompletion(db, c.id, { now: clock.now, byAdult: true });
		expect(settleHabitStar(db, 'kid', MON, clock.now)).toBe(false);
		expect(habitRows()[0].status).toBe('rejected');
		expect(starBalance(db, 'kid')).toBe(0);
		check(fish);
		settleHabitStar(db, 'kid', MON, clock.now);
		expect(habitRows()).toHaveLength(1);
		expect(starBalance(db, 'kid')).toBe(1);
	});

	it('pays nothing on a day with no habits', () => {
		expect(settleHabitStar(db, 'kid', MON, clock.now)).toBe(false);
		expect(habitRows()).toEqual([]);
	});
});

describe('habitSummary', () => {
	it("tallies the week so far and reports today's star", () => {
		const fish = habit('Feed the fish');
		const towels = habit('Hang up towels');
		check(fish, MON);
		check(towels, MON);
		check(fish, TUE);
		expect(habitSummary(db, 'kid', TUE)).toEqual({
			today: { due: 2, done: 1 },
			week: { due: 4, done: 3 },
			starEarned: false
		});
		expect(habitSummary(db, 'kid', MON).starEarned).toBe(true);
	});
});
