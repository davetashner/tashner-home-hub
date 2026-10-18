import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { completeChore, createChore } from './ledger.js';
import { habitSummary } from './habit-day.js';
import { awardStreakMilestones, streakSummary } from './streaks.js';
import { starBalance } from './stars.js';
import { addDays } from '#lib/domain/streaks.js';
import {
	clearVacation,
	endVacationNow,
	onVacation,
	readVacation,
	setVacation,
	VACATION_SETTING_KEY
} from './vacation.js';

const DAY0 = '2026-03-02'; // a Monday
const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
const clock = (date: string) => ({ now: at(date), timeZone: 'UTC' });
let db: Db;
let choreId: string;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values({ id: 'kid', name: 'Kid A', role: 'child', color: 'blue' })
		.run();
	choreId = createChore(db, {
		title: 'Dishes',
		memberIds: ['kid'],
		schedule: `DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY`,
		requiresApproval: false,
		kind: 'habit'
	}).id;
});
const finish = (date: string) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: at(date) });

describe('vacation setting', () => {
	it('stores, reads and clears the range', () => {
		expect(readVacation(db)).toBeNull();
		setVacation(db, { start: '2026-03-05', back: '2026-03-08' });
		expect(readVacation(db)).toEqual({ start: '2026-03-05', back: '2026-03-08' });
		expect(onVacation(db, '2026-03-07')).toBe(true);
		expect(onVacation(db, '2026-03-08')).toBe(false);
		clearVacation(db);
		expect(readVacation(db)).toBeNull();
	});

	it('reads corrupt values as none', () => {
		db.insert(schema.settings).values({ key: VACATION_SETTING_KEY, value: '{oops' }).run();
		expect(readVacation(db)).toBeNull();
		db.update(schema.settings).set({ value: '{"start":"nope"}' }).run();
		expect(readVacation(db)).toBeNull();
	});
});

describe('endVacationNow', () => {
	it('does nothing without a vacation', () => {
		expect(endVacationNow(db, clock(DAY0))).toBeNull();
	});
	it('ends an open-ended vacation today, resuming tomorrow', () => {
		setVacation(db, { start: '2026-03-01', back: null });
		expect(endVacationNow(db, clock(DAY0))).toEqual({ start: '2026-03-01', back: '2026-03-03' });
		expect(onVacation(db, DAY0)).toBe(true);
		expect(onVacation(db, '2026-03-03')).toBe(false);
	});
	it('shortens a range that runs past today', () => {
		setVacation(db, { start: '2026-03-01', back: '2026-03-20' });
		expect(endVacationNow(db, clock(DAY0))?.back).toBe('2026-03-03');
	});
	it('removes a vacation that has not started', () => {
		setVacation(db, { start: '2026-04-01', back: null });
		expect(endVacationNow(db, clock(DAY0))).toBeNull();
		expect(readVacation(db)).toBeNull();
	});
	it('leaves a finished vacation alone', () => {
		setVacation(db, { start: '2026-03-01', back: '2026-03-02' });
		expect(endVacationNow(db, clock(DAY0))).toEqual({ start: '2026-03-01', back: '2026-03-02' });
	});
});

describe('streaks across a vacation', () => {
	it('skips vacation days without breaking or extending the run', () => {
		finish('2026-03-02');
		finish('2026-03-03');
		setVacation(db, { start: '2026-03-04', back: '2026-03-08' });
		// Paused: still 2 on a vacation day and on the day before the return.
		expect(streakSummary(db, 'kid', clock('2026-03-05')).days).toBe(2);
		expect(streakSummary(db, 'kid', clock('2026-03-07')).days).toBe(2);
		// Back: today is open (not a miss), so the run is intact.
		expect(streakSummary(db, 'kid', clock('2026-03-08')).days).toBe(2);
		finish('2026-03-08');
		expect(streakSummary(db, 'kid', clock('2026-03-08')).days).toBe(3);
	});

	it('breaks without a vacation (control)', () => {
		finish('2026-03-02');
		finish('2026-03-03');
		finish('2026-03-08');
		expect(streakSummary(db, 'kid', clock('2026-03-09')).days).toBe(1);
	});

	it('pays no milestone twice across a vacation', () => {
		for (let i = 0; i < 3; i++) finish(addDays('2026-03-02', i));
		setVacation(db, { start: '2026-03-05', back: '2026-03-10' });
		expect(awardStreakMilestones(db, 'kid', clock('2026-03-04')).map((m) => m.days)).toEqual([3]);
		const balance = starBalance(db, 'kid');
		expect(awardStreakMilestones(db, 'kid', clock('2026-03-07'))).toEqual([]);
		finish('2026-03-10');
		expect(awardStreakMilestones(db, 'kid', clock('2026-03-10'))).toEqual([]);
		expect(starBalance(db, 'kid')).toBe(balance); // no second payout for the 3-day milestone
	});

	it('ending early resumes the next day', () => {
		finish('2026-03-02');
		setVacation(db, { start: '2026-03-03', back: null });
		endVacationNow(db, clock('2026-03-04'));
		expect(streakSummary(db, 'kid', clock('2026-03-04')).days).toBe(1);
		// 03-05 is a normal day again; unfinished today is not a miss yet, tomorrow it is.
		expect(streakSummary(db, 'kid', clock('2026-03-05')).days).toBe(1);
		expect(streakSummary(db, 'kid', clock('2026-03-06')).days).toBe(0);
	});
});

describe('habit week tally', () => {
	it('skips vacation days', () => {
		finish('2026-03-02');
		const before = habitSummary(db, 'kid', '2026-03-05').week;
		expect(before).toEqual({ due: 4, done: 1 });
		setVacation(db, { start: '2026-03-03', back: '2026-03-05' });
		expect(habitSummary(db, 'kid', '2026-03-05').week).toEqual({ due: 2, done: 1 });
	});
});
