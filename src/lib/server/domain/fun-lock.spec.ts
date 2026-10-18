import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { completeChore, createChore } from './ledger.js';
import { funLocks, funLockStatus, unlockFun } from './fun-lock.js';
import { judgeMissedPeriods, MISSED_SINCE_KEY } from './missed.js';

const TZ = 'UTC';
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);
const NOW = noon('2026-03-05');
let db: Db;

function job(title: string, over: Partial<Parameters<typeof createChore>[1]> = {}) {
	const c = createChore(db, {
		title,
		memberIds: ['kid'],
		schedule: 'DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY',
		requiresApproval: false,
		...over
	});
	db.update(schema.chores)
		.set({ createdAt: noon('2026-03-01') })
		.where(eq(schema.chores.id, c.id))
		.run();
	return c.id;
}
/** Judges the ended periods (the scheduler's job), then reads the lock. */
const check = (now: number, zone: string) => {
	judgeMissedPeriods(db, now, zone);
	return funLockStatus(db, 'kid', now, zone);
};
const status = () => check(NOW, TZ);

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members).values({ id: 'kid', name: 'Kid', role: 'child', color: 'blue' }).run();
	db.insert(schema.members).values({ id: 'mum', name: 'Mum', role: 'adult', color: 'red' }).run();
	db.insert(schema.settings)
		.values({ key: MISSED_SINCE_KEY, value: JSON.stringify('2026-03-01') })
		.run();
});

describe('funLockStatus', () => {
	it('is open when nothing was missed', () => {
		job('Dishes');
		expect(check(noon('2026-03-02'), TZ).locked).toBe(false);
	});

	it('locks after a miss, listing what is left to finish today', () => {
		job('Dishes');
		job('Bins');
		const s = status();
		expect(s.locked).toBe(true);
		expect(s.missed.sort()).toEqual(['Bins', 'Dishes']);
		expect(s.remaining.map((r) => r.title).sort()).toEqual(['Bins', 'Dishes']);
	});

	it('opens once every job due today is done, and a pending one counts', () => {
		const a = job('Dishes');
		const b = job('Bins', { requiresApproval: true });
		completeChore(db, { choreId: a, memberId: 'kid', date: '2026-03-05', now: NOW });
		expect(status().remaining.map((r) => r.title)).toEqual(['Bins']);
		completeChore(db, { choreId: b, memberId: 'kid', date: '2026-03-05', now: NOW });
		expect(status().locked).toBe(false);
	});

	it('ignores habits and any-day to-dos when deciding what is left', () => {
		const a = job('Dishes');
		job('Brush teeth', { kind: 'habit' });
		job('Room', {
			schedule: 'DTSTART:20260302T000000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1\nX-HUB-FLEX:1'
		});
		const s = status();
		expect(s.remaining.map((r) => r.title)).toEqual(['Dishes']);
		completeChore(db, { choreId: a, memberId: 'kid', date: '2026-03-05', now: NOW });
		expect(status().locked).toBe(false);
	});

	it('does not lock when nothing is due today', () => {
		job('Dishes', { schedule: 'DTSTART:20260302T000000Z\nRRULE:FREQ=DAILY;COUNT=1' });
		expect(status()).toMatchObject({ locked: false, remaining: [] });
	});

	it('forgets a miss from before yesterday', () => {
		job('Dishes');
		check(noon('2026-03-03'), TZ); // judges 03-02
		expect(check(noon('2026-03-04'), TZ).missed).toContain('Dishes');
		db.delete(schema.missedJudgments).run();
		db.insert(schema.missedJudgments)
			.values({
				id: 'old',
				choreId: db.select().from(schema.chores).get()!.id,
				memberId: 'kid',
				periodKey: '2026-03-01',
				periodEnd: '2026-03-01',
				missed: true,
				starsRemoved: 0,
				judgedAt: noon('2026-03-02')
			})
			.run();
		db.update(schema.settings).set({ value: '"2026-03-05"' }).run();
		expect(check(noon('2026-03-05'), TZ).locked).toBe(false);
	});
});

describe('unlockFun', () => {
	it('opens the tabs for today and logs who and when', () => {
		job('Dishes');
		expect(status().locked).toBe(true);
		const s = unlockFun(db, {
			memberId: 'kid',
			by: { id: 'mum', name: 'Mum' },
			now: NOW,
			timeZone: TZ
		});
		expect(s).toMatchObject({ locked: false, unlockedToday: true });
		expect(db.select().from(schema.funUnlocks).all()).toEqual([
			expect.objectContaining({
				memberId: 'kid',
				day: '2026-03-05',
				unlockedBy: 'mum',
				unlockedByName: 'Mum',
				unlockedAt: NOW
			})
		]);
		// Tomorrow another miss locks again.
		expect(check(noon('2026-03-06'), TZ).locked).toBe(true);
	});

	it('refuses an unknown child or an adult', () => {
		for (const id of ['nobody', 'mum'])
			expect(() => unlockFun(db, { memberId: id, by: { id: 'mum', name: 'Mum' } })).toThrow(
				'Child not found'
			);
	});

	it('lists every child', () => {
		job('Dishes');
		expect(funLocks(db, NOW, TZ)).toHaveLength(1);
		expect(funLocks(db).length).toBe(1);
	});
});
