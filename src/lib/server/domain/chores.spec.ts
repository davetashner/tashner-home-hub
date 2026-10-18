import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import {
	archiveChore,
	choresForDay,
	createChore,
	isDueOn,
	listChores,
	localDateIn,
	parseSchedule,
	scheduleToRRule,
	updateChore,
	type Schedule
} from './chores.js';
import { completeChore, approveCompletion, rejectCompletion, undoCompletion } from './ledger.js';
import { LedgerError } from './ledger.js';
import { setApprovalDefault } from './approval-setting.js';

const TZ = 'America/Chicago';
const clock = { now: Date.UTC(2026, 0, 5, 18), timeZone: TZ }; // 2026-01-05, a Monday
let db: Db;

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as LedgerError).code;
	}
	return 'none';
};
const titles = (date: string, member = 'kid') =>
	choresForDay(db, member, date, TZ).flatMap((g) => g.chores.map((c) => c.title));

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Test Kid', role: 'child', color: 'member-1' },
			{ id: 'mom', name: 'Test Adult', role: 'adult', color: 'member-2' }
		])
		.run();
});

describe('validation', () => {
	it('accepts a full valid chore and applies defaults', () => {
		const c = createChore(
			db,
			{ title: '  Dishes ', memberIds: ['kid', 'mom', 'kid'], icon: '🍽️' },
			clock
		);
		expect(c).toMatchObject({
			title: 'Dishes',
			icon: '🍽️',
			memberIds: ['kid', 'mom'],
			stars: 1,
			timeOfDay: 'anytime',
			requiresApproval: false,
			archived: false,
			schedule: { type: 'daily', start: '2026-01-05' }
		});
		expect(createChore(db, { title: 'x', requiresApproval: true }, clock).requiresApproval).toBe(
			true
		);
	});

	it('starts new chores with approval when the household setting is on', () => {
		setApprovalDefault(db, true);
		expect(createChore(db, { title: 'Dishes' }, clock).requiresApproval).toBe(true);
		expect(createChore(db, { title: 'x', requiresApproval: false }, clock).requiresApproval).toBe(
			false
		);
	});

	it.each([
		[{ title: '' }],
		[{ title: 'a'.repeat(61) }],
		[{ title: 5 as unknown as string }],
		[{ title: 'a', icon: 'ab' }],
		[{ title: 'a', icon: '🙂🙂' }],
		[{ title: 'a', icon: 3 as unknown as string }],
		[{ title: 'a', stars: 0 }],
		[{ title: 'a', stars: 11 }],
		[{ title: 'a', stars: 1.5 }],
		[{ title: 'a', memberIds: ['ghost'] }],
		[{ title: 'a', memberIds: 'kid' as unknown as string[] }],
		[{ title: 'a', timeOfDay: 'night' }],
		[{ title: 'a', schedule: { type: 'yearly' } }],
		[{ title: 'a', schedule: { type: 'weekdays', days: [] } }],
		[{ title: 'a', schedule: { type: 'weekdays', days: ['XX'] } }],
		[{ title: 'a', schedule: { type: 'daily', start: '2026-02-30' } }],
		[{ title: 'a', schedule: { type: 'daily', start: 'soon' } }]
	])('rejects %j', (input) => {
		expect(code(() => createChore(db, input as never, clock))).toBe('invalid');
	});

	it('treats empty icon as none and rejects an unknown time zone', () => {
		expect(createChore(db, { title: 'a', icon: '' }, clock).icon).toBeNull();
		expect(code(() => localDateIn(0, 'Mars/Base'))).toBe('invalid');
		expect(code(() => choresForDay(db, 'kid', '2026-01-05', 'Mars/Base'))).toBe('invalid');
		expect(code(() => choresForDay(db, 'kid', 'nope', TZ))).toBe('invalid');
	});

	it('derives the default start day from the clock time zone', () => {
		// 03:00 UTC on Jan 6 is still Jan 5 in Chicago.
		const c = createChore(db, { title: 'a' }, { now: Date.UTC(2026, 0, 6, 3), timeZone: TZ });
		expect(c.schedule.start).toBe('2026-01-05');
		expect(createChore(db, { title: 'b' }).schedule.start).toMatch(/^\d{4}-\d\d-\d\d$/);
	});
});

describe('update, archive, list', () => {
	it('updates fields, keeps the start day, and validates', () => {
		const c = createChore(
			db,
			{ title: 'a', schedule: { type: 'weekly', start: '2026-01-07' } },
			clock
		);
		const u = updateChore(
			db,
			c.id,
			{
				title: 'b',
				icon: null,
				stars: 5,
				memberIds: ['kid'],
				timeOfDay: 'evening',
				requiresApproval: false,
				schedule: { type: 'weekdays', days: ['FR', 'MO'] }
			},
			clock
		);
		expect(u).toMatchObject({
			title: 'b',
			stars: 5,
			timeOfDay: 'evening',
			requiresApproval: false,
			schedule: { type: 'weekdays', start: '2026-01-07', days: ['MO', 'FR'] }
		});
		expect(updateChore(db, c.id, {}, clock).title).toBe('b');
		expect(code(() => updateChore(db, c.id, { stars: 99 }, clock))).toBe('invalid');
		expect(code(() => updateChore(db, c.id, { requiresApproval: 'y' as never }))).toBe('invalid');
		expect(code(() => updateChore(db, 'nope', { title: 'x' }))).toBe('not_found');
	});

	it('archives, hides from lists, and 404s for unknown ids', () => {
		const a = createChore(db, { title: 'a' }, clock);
		createChore(db, { title: 'b' }, clock);
		expect(archiveChore(db, a.id).archived).toBe(true);
		expect(listChores(db, clock).map((c) => c.title)).toEqual(['b']);
		expect(listChores(db, { ...clock, includeArchived: true })).toHaveLength(2);
		expect(code(() => archiveChore(db, 'nope'))).toBe('not_found');
	});
});

describe('schedules', () => {
	const s = (x: Schedule) => x;
	it('round-trips every type through RRULE text', () => {
		const all = [
			s({ type: 'once', start: '2026-02-03' }),
			s({ type: 'daily', start: '2026-02-03' }),
			s({ type: 'weekdays', start: '2026-02-03', days: ['MO', 'WE'] }),
			s({ type: 'weekly', start: '2026-02-03' }),
			s({ type: 'monthly', start: '2026-02-03' })
		];
		for (const x of all) expect(parseSchedule(scheduleToRRule(x), 'z')).toEqual(x);
		expect(scheduleToRRule(all[2])).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
		expect(parseSchedule(null, '2026-01-01')).toEqual({ type: 'daily', start: '2026-01-01' });
		expect(parseSchedule('FREQ=WEEKLY', '2026-01-01')).toEqual({
			type: 'weekly',
			start: '2026-01-01'
		});
	});

	it('once is due only on its date', () => {
		const x = s({ type: 'once', start: '2026-02-03' });
		expect(isDueOn(x, '2026-02-03')).toBe(true);
		expect(isDueOn(x, '2026-02-04')).toBe(false);
		expect(isDueOn(x, '2026-02-02')).toBe(false);
	});

	it('daily is due every day from start', () => {
		const x = s({ type: 'daily', start: '2026-02-03' });
		expect(isDueOn(x, '2026-02-02')).toBe(false);
		expect(isDueOn(x, '2026-02-03')).toBe(true);
		expect(isDueOn(x, '2027-02-03')).toBe(true);
	});

	it('weekdays are due on the chosen days only', () => {
		const x = s({ type: 'weekdays', start: '2026-01-05', days: ['MO', 'WE', 'SU'] });
		// Jan 5 2026 is a Monday.
		expect(
			['05', '06', '07', '08', '09', '10', '11'].map((d) => isDueOn(x, `2026-01-${d}`))
		).toEqual([true, false, true, false, false, false, true]);
	});

	it('weekly repeats on the start weekday; monthly on the start day of month', () => {
		const w = s({ type: 'weekly', start: '2026-01-07' });
		expect(isDueOn(w, '2026-01-14')).toBe(true);
		expect(isDueOn(w, '2026-01-13')).toBe(false);
		const m = s({ type: 'monthly', start: '2026-01-15' });
		expect(isDueOn(m, '2026-02-15')).toBe(true);
		expect(isDueOn(m, '2026-02-14')).toBe(false);
	});
});

describe('DST boundaries (US 2026: Mar 8 spring forward, Nov 1 fall back)', () => {
	it('weekday chores land on the right local day across both changes', () => {
		createChore(
			db,
			{
				title: 'Sun+Mon',
				memberIds: ['kid'],
				schedule: { type: 'weekdays', days: ['SU', 'MO'], start: '2026-03-01' }
			},
			clock
		);
		expect(titles('2026-03-07')).toEqual([]);
		expect(titles('2026-03-08')).toEqual(['Sun+Mon']); // Sunday, 23-hour day
		expect(titles('2026-03-09')).toEqual(['Sun+Mon']);
		expect(titles('2026-03-10')).toEqual([]);
		expect(titles('2026-11-01')).toEqual(['Sun+Mon']); // Sunday, 25-hour day
		expect(titles('2026-11-02')).toEqual(['Sun+Mon']);
		expect(titles('2026-11-03')).toEqual([]);
	});

	it('daily, weekly and monthly anchors survive the change', () => {
		createChore(
			db,
			{ title: 'D', memberIds: ['kid'], schedule: { type: 'daily', start: '2026-03-01' } },
			clock
		);
		createChore(
			db,
			{ title: 'W', memberIds: ['kid'], schedule: { type: 'weekly', start: '2026-03-01' } },
			clock
		);
		createChore(
			db,
			{ title: 'M', memberIds: ['kid'], schedule: { type: 'monthly', start: '2026-03-08' } },
			clock
		);
		createChore(
			db,
			{ title: 'O', memberIds: ['kid'], schedule: { type: 'once', start: '2026-11-01' } },
			clock
		);
		expect(titles('2026-03-08')).toEqual(['D', 'W', 'M']);
		expect(titles('2026-03-09')).toEqual(['D']);
		expect(titles('2026-04-08')).toEqual(['D', 'M']);
		expect(titles('2026-11-01')).toEqual(['D', 'W', 'O']);
		expect(titles('2026-11-02')).toEqual(['D']);
	});

	it('maps instants to the local day on change days', () => {
		// 2026-03-08 07:59Z is still Mar 7 23:59 CST; 08:00Z is Mar 8 00:00 CST... 06:00Z is 00:00 CST.
		expect(localDateIn(Date.UTC(2026, 2, 8, 5, 59), TZ)).toBe('2026-03-07');
		expect(localDateIn(Date.UTC(2026, 2, 8, 6, 0), TZ)).toBe('2026-03-08');
		expect(localDateIn(Date.UTC(2026, 10, 1, 4, 59), TZ)).toBe('2026-10-31');
		expect(localDateIn(Date.UTC(2026, 10, 1, 5, 0), TZ)).toBe('2026-11-01');
	});
});

describe('choresForDay', () => {
	it('groups by time of day in fixed order and treats unset as anytime', () => {
		const mk = (title: string, timeOfDay?: string) =>
			createChore(db, { title, memberIds: ['kid'], timeOfDay }, clock);
		mk('E', 'evening');
		mk('A', 'anytime');
		mk('M', 'morning');
		mk('P', 'afternoon');
		const raw = db
			.insert(schema.chores)
			.values({ id: 'legacy', title: 'L', memberIds: '["kid"]' })
			.returning()
			.get();
		const groups = choresForDay(db, 'kid', '2026-01-05', TZ);
		expect(groups.map((g) => g.timeOfDay)).toEqual(['morning', 'afternoon', 'evening', 'anytime']);
		expect(groups[3].chores.map((c) => c.title).sort()).toEqual(['A', 'L']);
		expect(raw.id).toBe('legacy');
	});

	it('excludes archived chores, other members, and unassigned chores', () => {
		const a = createChore(db, { title: 'Arch', memberIds: ['kid'] }, clock);
		createChore(db, { title: 'Mine', memberIds: ['kid'] }, clock);
		createChore(db, { title: 'Hers', memberIds: ['mom'] }, clock);
		createChore(db, { title: 'Nobody' }, clock);
		archiveChore(db, a.id);
		expect(titles('2026-01-05')).toEqual(['Mine']);
		expect(titles('2026-01-05', 'mom')).toEqual(['Hers']);
	});

	it("joins today's completion status (best state wins, other days ignored)", () => {
		const c = createChore(
			db,
			{ title: 'Dishes', memberIds: ['kid'], requiresApproval: true },
			clock
		);
		const status = (date = '2026-01-05') => choresForDay(db, 'kid', date, TZ)[0].chores[0];
		expect(status()).toMatchObject({ status: 'none', completionId: null });

		const { completion } = completeChore(db, {
			choreId: c.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: 1
		});
		expect(status()).toMatchObject({ status: 'pending', completionId: completion.id });
		approveCompletion(db, completion.id);
		expect(status().status).toBe('approved');
		expect(status('2026-01-06').status).toBe('none');

		undoCompletion(db, completion.id, { now: 2, byAdult: true });
		expect(status().status).toBe('undone');
		const second = completeChore(db, {
			choreId: c.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: 3
		});
		rejectCompletion(db, second.completion.id);
		expect(status().status).toBe('rejected');
		const third = completeChore(db, { choreId: c.id, memberId: 'kid', date: '2026-01-05', now: 4 });
		expect(status()).toMatchObject({ status: 'pending', completionId: third.completion.id });
	});
});

describe('habits (hub-esf)', () => {
	const habit = () =>
		createChore(db, { title: 'Feed the fish', kind: 'habit', memberIds: ['kid'], stars: 5 }, clock);

	it('creates habits with no stars and no approval, whatever is asked', () => {
		expect(habit()).toMatchObject({ kind: 'habit', stars: 0, requiresApproval: false });
		expect(createChore(db, { title: 'Wash window' }, clock).kind).toBe('star_job');
		expect(code(() => createChore(db, { title: 'x', kind: 'nap' as never }, clock))).toBe(
			'invalid'
		);
	});

	it('never changes kind, and refuses stars or approval on a habit', () => {
		const h = habit();
		const job = createChore(db, { title: 'Wash window' }, clock);
		expect(code(() => updateChore(db, h.id, { kind: 'star_job' }, clock))).toBe('invalid');
		expect(code(() => updateChore(db, job.id, { kind: 'habit' }, clock))).toBe('invalid');
		expect(code(() => updateChore(db, h.id, { stars: 2 }, clock))).toBe('invalid');
		expect(code(() => updateChore(db, h.id, { requiresApproval: true }, clock))).toBe('invalid');
		expect(updateChore(db, h.id, { title: 'Feed fish', kind: 'habit' }, clock).title).toBe(
			'Feed fish'
		);
	});

	it('lists by kind', () => {
		const h = habit();
		const job = createChore(db, { title: 'Wash window' }, clock);
		expect(listChores(db, { ...clock, kind: 'habit' }).map((c) => c.id)).toEqual([h.id]);
		expect(listChores(db, { ...clock, kind: 'star_job' }).map((c) => c.id)).toEqual([job.id]);
		expect(listChores(db, clock)).toHaveLength(2);
	});

	it('completes a habit as an approved check with no stars in the ledger', () => {
		const h = habit();
		const { completion } = completeChore(db, {
			choreId: h.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: clock.now
		});
		expect(completion).toMatchObject({ status: 'approved', starsAwarded: 0 });
		expect(db.select().from(schema.starTransactions).all()).toEqual([]);
		expect(undoCompletion(db, completion.id, { now: clock.now, byAdult: false }).status).toBe(
			'undone'
		);
	});
});

describe('habit follow-ups (hub-obz)', () => {
	const habit = () =>
		createChore(db, { title: 'Feed the fish', kind: 'habit', memberIds: ['kid'] }, clock);

	it('accepts requiresApproval:false on a habit, as a no-op', () => {
		const h = habit();
		expect(updateChore(db, h.id, { requiresApproval: false }, clock)).toMatchObject({
			kind: 'habit',
			requiresApproval: false
		});
	});

	it('cannot approve or reject a habit completion, which is already approved', () => {
		const h = habit();
		const { completion } = completeChore(db, {
			choreId: h.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: clock.now
		});
		expect(code(() => approveCompletion(db, completion.id))).not.toBe('none');
		expect(code(() => rejectCompletion(db, completion.id))).not.toBe('none');
		expect(db.select().from(schema.starTransactions).all()).toEqual([]);
	});
});
