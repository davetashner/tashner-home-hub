import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import {
	choresForDay,
	createChore,
	isDueOn,
	parseSchedule,
	scheduleToRRule,
	updateChore
} from './chores.js';
import { flexOf, flexPeriod, mondayOf } from './flex.js';
import { completeChore, rejectCompletion, undoCompletion, LedgerError } from './ledger.js';
import { weeklySummary } from './weekly-summary.js';

const TZ = 'UTC';
const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
// 2026-03-02 is a Monday.
const clock = { now: at('2026-03-04'), timeZone: TZ };
let db: Db;

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as LedgerError).code;
	}
	return 'none';
};
const week = (date: string) =>
	choresForDay(db, 'kid', date, TZ).find((g) => g.timeOfDay === 'week')?.chores ?? [];
const done = (choreId: string, date: string) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: at(date) });

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Robin', role: 'child', color: 'member-1' },
			{ id: 'mum', name: 'Sam', role: 'adult', color: 'member-2' }
		])
		.run();
});

describe('flexPeriod', () => {
	it('uses Monday-to-Sunday weeks', () => {
		expect(mondayOf('2026-03-08')).toBe('2026-03-02'); // Sunday
		expect(mondayOf('2026-03-02')).toBe('2026-03-02');
		expect(flexPeriod('2026-03-04', 1, '2026-03-08')).toEqual({
			start: '2026-03-02',
			end: '2026-03-08',
			week: 1,
			weeks: 1
		});
	});

	it('pairs weeks from the start week for every-two-weeks', () => {
		expect(flexPeriod('2026-03-04', 2, '2026-03-10')).toEqual({
			start: '2026-03-02',
			end: '2026-03-15',
			week: 2,
			weeks: 2
		});
		expect(flexPeriod('2026-03-04', 2, '2026-03-16')).toMatchObject({
			start: '2026-03-16',
			end: '2026-03-29',
			week: 1
		});
	});

	it('has no period before the start day', () => {
		expect(flexPeriod('2026-03-04', 1, '2026-03-03')).toBeNull();
	});

	it('reads the marker and interval from stored text', () => {
		expect(flexOf('DTSTART:20260304T000000Z\nRRULE:FREQ=WEEKLY', 'x')).toBeNull();
		expect(flexOf(null, 'x')).toBeNull();
		expect(flexOf('RRULE:FREQ=WEEKLY;INTERVAL=2\nX-HUB-FLEX:1', '2026-01-01')).toEqual({
			start: '2026-01-01',
			every: 2
		});
	});
});

describe('flex schedules', () => {
	it('round-trips through RRULE text and is never due on a fixed day', () => {
		for (const every of [1, 2] as const) {
			const s = { type: 'flex' as const, start: '2026-03-04', every };
			expect(parseSchedule(scheduleToRRule(s), 'x')).toEqual(s);
			expect(isDueOn(s, '2026-03-04')).toBe(false);
		}
	});

	it('validates every and keeps habits daily', () => {
		const flex = (every: unknown) =>
			createChore(db, { title: 'Room', schedule: { type: 'flex', every } as never }, clock);
		expect(code(() => flex(3))).toBe('invalid');
		expect(code(() => flex(undefined))).toBe('invalid');
		expect(flex(2).schedule).toEqual({ type: 'flex', start: '2026-03-04', every: 2 });
		expect(
			code(() =>
				createChore(
					db,
					{ title: 'Teeth', kind: 'habit', schedule: { type: 'flex', every: 1 } },
					clock
				)
			)
		).toBe('invalid');
		const habit = createChore(db, { title: 'Teeth', kind: 'habit' }, clock);
		expect(
			code(() => updateChore(db, habit.id, { schedule: { type: 'flex', every: 1 } }, clock))
		).toBe('invalid');
		const job = createChore(db, { title: 'Bed' }, clock);
		expect(
			updateChore(db, job.id, { schedule: { type: 'flex', every: 1 } }, clock).schedule
		).toEqual({
			type: 'flex',
			start: '2026-03-04',
			every: 1
		});
	});
});

describe('choresForDay with flexible to-dos', () => {
	it('shows an open one every day of its period, with when it is due', () => {
		const room = createChore(
			db,
			{ title: 'Room', memberIds: ['kid'], schedule: { type: 'flex', every: 1 } },
			clock
		);
		expect(week('2026-03-03')).toEqual([]); // before the start
		for (const date of ['2026-03-04', '2026-03-06', '2026-03-08']) {
			const [c] = week(date);
			expect(c).toMatchObject({ id: room.id, status: 'none', completionId: null });
			expect(c.flex).toEqual({ dueBy: '2026-03-08', week: 1, weeks: 1 });
		}
		// The time-of-day groups never hold it.
		expect(choresForDay(db, 'kid', '2026-03-04', TZ).map((g) => g.timeOfDay)).toEqual(['week']);
	});

	it('stays today once done, is gone the rest of the period, and starts fresh next period', () => {
		const room = createChore(
			db,
			{ title: 'Room', memberIds: ['kid'], schedule: { type: 'flex', every: 1 } },
			clock
		);
		const c = done(room.id, '2026-03-05').completion;
		expect(week('2026-03-05')[0]).toMatchObject({ status: 'pending', completionId: c.id });
		expect(week('2026-03-06')).toEqual([]);
		expect(week('2026-03-09')[0]).toMatchObject({ status: 'none' });
	});

	it('comes back after an undo or a rejection', () => {
		const room = createChore(
			db,
			{ title: 'Room', memberIds: ['kid'], schedule: { type: 'flex', every: 1 } },
			clock
		);
		undoCompletion(db, done(room.id, '2026-03-04').completion.id, {
			byAdult: true,
			now: at('2026-03-04')
		});
		expect(week('2026-03-05')[0]).toMatchObject({ status: 'none', completionId: null });
		rejectCompletion(db, done(room.id, '2026-03-05').completion.id);
		expect(week('2026-03-06')).toHaveLength(1);
	});

	it('runs over two weeks for every-two-weeks', () => {
		const play = createChore(
			db,
			{ title: 'Playroom', memberIds: ['kid'], schedule: { type: 'flex', every: 2 } },
			clock
		);
		expect(week('2026-03-12')[0].flex).toEqual({ dueBy: '2026-03-15', week: 2, weeks: 2 });
		done(play.id, '2026-03-04');
		expect(week('2026-03-12')).toEqual([]);
		expect(week('2026-03-16')).toHaveLength(1);
	});

	it('pays once per period, whichever day it is tapped', () => {
		const room = createChore(
			db,
			{ title: 'Room', memberIds: ['kid'], schedule: { type: 'flex', every: 1 } },
			clock
		);
		const first = done(room.id, '2026-03-04');
		const again = done(room.id, '2026-03-07');
		expect(again).toEqual({ completion: first.completion, created: false });
		expect(done(room.id, '2026-03-09').created).toBe(true);
	});
});

describe('weekly summary with flexible to-dos', () => {
	it('counts one due per period, in the week the period ends', () => {
		const room = createChore(
			db,
			{
				title: 'Room',
				memberIds: ['kid'],
				schedule: { type: 'flex', every: 1 },
				requiresApproval: false
			},
			clock
		);
		const play = createChore(
			db,
			{ title: 'Playroom', memberIds: ['kid'], schedule: { type: 'flex', every: 2 } },
			clock
		);
		done(room.id, '2026-03-05');
		const now = at('2026-03-18');
		const first = weeklySummary(db, { week: '2026-03-02', now, timeZone: TZ }).children[0];
		expect(first).toMatchObject({ due: 1, done: 1, pending: 0, missed: [] });

		done(play.id, '2026-03-10');
		const second = weeklySummary(db, { week: '2026-03-09', now, timeZone: TZ }).children[0];
		expect(second).toMatchObject({ due: 2, done: 0, pending: 1 });
		expect(second.missed).toEqual([{ date: '2026-03-15', choreId: room.id, title: 'Room' }]);

		// The current week: due, but not missed before it ends.
		const current = weeklySummary(db, { week: '2026-03-16', now, timeZone: TZ }).children[0];
		expect(current).toMatchObject({ due: 1, done: 0, missed: [] });
	});
});
