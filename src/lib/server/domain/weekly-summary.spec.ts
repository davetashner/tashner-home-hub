import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { approveCompletion, awardBonus, completeChore, createChore } from './ledger.js';
import { buildWeeklySummary, weekStartOf, weeklySummary } from './weekly-summary.js';

const TZ = 'UTC';
const at = (date: string, time = '12:00:00') => Date.parse(`${date}T${time}Z`);
// 2026-03-02 is a Monday. "Now" is Wednesday 2026-03-11, so the last complete week is 03-02..03-08.
const NOW = at('2026-03-11');
let db: Db;
let dishes: string;
let trash: string;

function star(memberId: string, delta: number, reason: string, ms: number, status = 'approved') {
	db.insert(schema.starTransactions)
		.values({
			id: crypto.randomUUID(),
			memberId,
			delta,
			reason: reason as 'chore',
			status: status as 'approved',
			createdAt: ms
		})
		.run();
}

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Kid', role: 'child', color: 'member-1' },
			{ id: 'idle', name: 'Idle', role: 'child', color: 'member-2' },
			{ id: 'mum', name: 'Mum', role: 'adult', color: 'member-3' }
		])
		.run();
	dishes = createChore(db, {
		title: 'Dishes',
		memberIds: ['kid'],
		schedule: 'DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY',
		requiresApproval: false,
		stars: 2
	}).id;
	trash = createChore(db, {
		title: 'Trash',
		memberIds: ['kid'],
		schedule: 'DTSTART:20260301T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU,FR',
		requiresApproval: true,
		stars: 3
	}).id;
});

const done = (choreId: string, date: string) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: at(date) }).completion;

describe('weekStartOf', () => {
	it('snaps to Monday and rejects bad input', () => {
		expect(weekStartOf('2026-03-02')).toBe('2026-03-02');
		expect(weekStartOf('2026-03-08')).toBe('2026-03-02');
		expect(weekStartOf('2026-03-09')).toBe('2026-03-09');
		expect(() => weekStartOf('nope')).toThrow(/YYYY-MM-DD/);
		expect(() => weekStartOf('2026-02-31')).toThrow(/YYYY-MM-DD/);
	});
});

describe('weeklySummary', () => {
	it('summarises the last complete week by default', () => {
		for (const d of ['2026-03-02', '2026-03-03', '2026-03-05']) done(dishes, d);
		const t = done(trash, '2026-03-03'); // Tuesday, awaits approval
		done(trash, '2026-03-06'); // Friday
		awardBonus(db, { memberId: 'kid', delta: 4, note: 'nice' });
		approveCompletion(db, t.id);
		const s = weeklySummary(db, { now: NOW, timeZone: TZ });
		expect(s).toMatchObject({
			start: '2026-03-02',
			end: '2026-03-08',
			through: '2026-03-08',
			partial: false,
			prev: '2026-02-23',
			next: '2026-03-09'
		});
		expect(s.children.map((c) => c.memberId).sort()).toEqual(['idle', 'kid']);
		const kid = s.children.find((c) => c.memberId === 'kid')!;
		// Dishes due all 7 days (3 done), trash due Tue+Fri (1 approved, 1 pending).
		expect(kid).toMatchObject({ due: 9, done: 4, pending: 1 });
		expect(kid.missed).toHaveLength(4);
		expect(kid.missed[0]).toEqual({ date: '2026-03-04', choreId: dishes, title: 'Dishes' });
		expect(kid.earned).toBe(2 * 3 + 3); // approved trash stars + dishes; pending row excluded
		expect(kid.bestDay).toEqual({ date: '2026-03-03', stars: 5 });
		expect(kid).toMatchObject({ net: 9, balance: 9 }); // the bonus came after the week
		expect(s.family).toEqual({
			earned: kid.earned,
			spent: 0,
			removed: 0,
			net: kid.net,
			due: 9,
			done: 4,
			missed: 4
		});
	});

	it('a child with no chores has zeros and an empty missed list', () => {
		const idle = weeklySummary(db, { now: NOW, timeZone: TZ }).children.find(
			(c) => c.memberId === 'idle'
		)!;
		expect(idle).toEqual({
			memberId: 'idle',
			name: 'Idle',
			color: 'member-2',
			avatar: null,
			earned: 0,
			spent: 0,
			removed: 0,
			net: 0,
			balance: 0,
			due: 0,
			done: 0,
			pending: 0,
			missed: [],
			streak: 0,
			bestDay: null
		});
	});

	it('still calls the week in progress on its Sunday', () => {
		const sunday = Date.parse('2026-03-15T12:00:00Z');
		const s = weeklySummary(db, { week: '2026-03-15', now: sunday, timeZone: TZ });
		expect(s).toMatchObject({ start: '2026-03-09', through: '2026-03-15', partial: true });
		expect(s.next).toBeNull();
	});

	it('counts the current week so far and never misses today', () => {
		done(dishes, '2026-03-09');
		const s = weeklySummary(db, { week: '2026-03-11', now: NOW, timeZone: TZ });
		expect(s).toMatchObject({ start: '2026-03-09', through: '2026-03-11', partial: true });
		expect(s.next).toBeNull();
		const kid = s.children.find((c) => c.memberId === 'kid')!;
		expect(kid.due).toBe(4); // dishes Mon-Wed + trash Tue
		expect(kid.missed.map((m) => `${m.date} ${m.title}`)).toEqual([
			'2026-03-10 Dishes',
			'2026-03-10 Trash'
		]);
		expect(kid.streak).toBe(0);
		expect(() => weeklySummary(db, { week: '2026-03-16', now: NOW, timeZone: TZ })).toThrow(
			/not started/
		);
	});

	it('splits earned, spent and removed, and carries the balance across weeks', () => {
		star('kid', 5, 'bonus', at('2026-03-01')); // before the week
		star('kid', 3, 'streak', at('2026-03-04'));
		star('kid', -2, 'redemption', at('2026-03-05'));
		star('kid', -1, 'adjustment', at('2026-03-06'));
		star('kid', 2, 'adjustment', at('2026-03-07'));
		star('kid', 9, 'chore', at('2026-03-07'), 'pending');
		star('kid', 6, 'bonus', at('2026-03-09')); // after the week
		const kid = weeklySummary(db, { week: '2026-03-02', now: NOW, timeZone: TZ }).children.find(
			(c) => c.memberId === 'kid'
		)!;
		expect(kid).toMatchObject({ earned: 5, spent: 2, removed: 1, net: 2, balance: 7 });
		expect(kid.bestDay).toEqual({ date: '2026-03-04', stars: 3 });
	});

	it('streak is measured at the end of the week and ties pick the earlier day', () => {
		db.update(schema.chores).set({ archived: true }).where(eq(schema.chores.id, trash)).run();
		for (let i = 0; i < 8; i++) done(dishes, `2026-03-0${i + 1}`);
		star('kid', 1, 'bonus', at('2026-03-05'));
		star('kid', 1, 'bonus', at('2026-03-03'));
		const kid = weeklySummary(db, { week: '2026-03-02', now: NOW, timeZone: TZ }).children.find(
			(c) => c.memberId === 'kid'
		)!;
		expect(kid.streak).toBe(8);
		expect(kid.bestDay).toEqual({ date: '2026-03-03', stars: 3 }); // 2 chore stars + bonus
	});

	it('ignores archived chores and other kids chores', () => {
		db.update(schema.chores).set({ archived: true }).run();
		const s = weeklySummary(db, { now: NOW, timeZone: TZ });
		expect(s.family.due).toBe(0);
	});

	it('uses the household time zone by default', () => {
		db.insert(schema.settings)
			.values({ key: 'household.timeZone', value: JSON.stringify('Pacific/Auckland') })
			.run();
		// 2026-03-11 12:00Z is already Thursday in Auckland; the last full week is still 03-02..03-08.
		expect(weeklySummary(db, { now: NOW }).start).toBe('2026-03-02');
	});
});

describe('DST week', () => {
	const base = {
		today: '2026-11-04',
		timeZone: 'America/Chicago',
		children: [{ id: 'kid', name: 'Kid', color: 'member-1', avatar: null }],
		chores: [
			{
				id: 'c',
				title: 'Feed cat',
				memberIds: ['kid'],
				schedule: { type: 'daily' as const, start: '2026-01-01' }
			}
		],
		completions: [],
		streakOf: () => 0
	};

	it('places star rows by local day across the fall-back night', () => {
		const star = (createdAt: string, delta: number) => ({
			memberId: 'kid',
			delta,
			reason: 'bonus',
			createdAt: Date.parse(createdAt)
		});
		const s = buildWeeklySummary({
			...base,
			week: '2026-10-26',
			stars: [
				star('2026-10-26T04:59:00Z', 1), // Sun 23:59 CDT: previous week
				star('2026-10-26T05:00:00Z', 2), // Mon 00:00 CDT
				star('2026-11-02T05:59:00Z', 4), // Sun 23:59 CST: last day of the week
				star('2026-11-02T06:00:00Z', 8) // Mon 00:00 CST: next week
			]
		});
		expect(s.children[0]).toMatchObject({ earned: 6, balance: 7, due: 7 });
		expect(s.children[0].bestDay).toEqual({ date: '2026-11-01', stars: 4 });
		expect(s.next).toBe('2026-11-02');
	});
});
