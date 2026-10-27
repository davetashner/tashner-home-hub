import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../db/index.js';
import { practiceLogs, starTransactions } from '../db/schema.js';
import { setHouseholdTimeZone } from '../household.js';
import { balances, KID_UNDO_WINDOW_MS } from './ledger.js';
import { createMember } from './members.js';
import { createPracticeActivity, listPracticeActivities } from './practice-activities.js';
import { logPractice, practiceSummary, practiceWeek, undoPractice } from './practice-logs.js';

let db: Db;
let kid: string;
let reading: string;
const NOON = Date.UTC(2026, 9, 26, 17, 0, 0);
beforeEach(() => {
	db = openDb(':memory:');
	kid = createMember(db, { name: 'Ada', role: 'child', color: 'member-1' }).id;
	reading = listPracticeActivities(db)[0].id;
});
const log = (minutes: number, now = NOON, memberId = kid, activityId = reading) =>
	logPractice(db, { memberId, activityId, minutes, now });
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('logging practice', () => {
	it('awards an approved star for a full block and nothing for a short one', () => {
		expect(log(10).stars).toBe(0);
		expect(balances(db)[kid] ?? 0).toBe(0);
		const r = log(5);
		expect(r.stars).toBe(1);
		expect(balances(db)[kid]).toBe(1);
		const tx = db.select().from(starTransactions).all();
		expect(tx).toHaveLength(1);
		expect(tx[0]).toMatchObject({ reason: 'practice', status: 'approved', refId: r.log.id });
		expect(r.log.starTxId).toBe(tx[0].id);
		expect(r.summary).toMatchObject({ minutesToday: 15, starsToday: 1, minutesToNextStar: 15 });
	});
	it('stops at the daily cap and reports it', () => {
		const r = log(120);
		expect(r.stars).toBe(4);
		expect(r.summary).toMatchObject({ capReached: true, minutesToNextStar: null });
		expect(log(30).stars).toBe(0);
		expect(balances(db)[kid]).toBe(4);
	});
	it('starts each local day at zero, in the household zone', () => {
		setHouseholdTimeZone(db, 'Pacific/Auckland');
		const late = Date.UTC(2026, 9, 26, 10, 0, 0); // 23:00 on the 26th in Auckland
		log(15, late);
		expect(practiceSummary(db, kid, late + 60_000)[0].minutesToday).toBe(15);
		// Two hours later it is already the 27th in Auckland, though still the 26th in UTC.
		expect(practiceSummary(db, kid, late + 2 * 3_600_000)[0].minutesToday).toBe(0);
		expect(log(15, late + 2 * 3_600_000).stars).toBe(1);
	});
	it('keeps kids and activities separate', () => {
		const bo = createMember(db, { name: 'Bo', role: 'child', color: 'member-2' }).id;
		const piano = listPracticeActivities(db)[1].id;
		log(15);
		expect(log(15, NOON, bo).summary.minutesToday).toBe(15);
		expect(log(15, NOON, kid, piano).summary.minutesToday).toBe(15);
		expect(practiceSummary(db, kid, NOON).map((s) => s.minutesToday)).toEqual([15, 15]);
	});
	it('rejects bad input', () => {
		const mum = createMember(db, { name: 'Mum', role: 'adult', color: 'member-3' }).id;
		const only = createPracticeActivity(db, {
			name: 'Piano',
			minutesPerBlock: 10,
			starsPerBlock: 1,
			dailyStarCap: 2,
			memberIds: [kid]
		});
		const off = createPracticeActivity(db, {
			name: 'Chess',
			minutesPerBlock: 10,
			starsPerBlock: 1,
			dailyStarCap: 2,
			active: false
		});
		const bo = createMember(db, { name: 'Bo', role: 'child', color: 'member-2' }).id;
		expect(code(() => log(0))).toBe('invalid');
		expect(code(() => log(1.5))).toBe('invalid');
		expect(code(() => log(601))).toBe('invalid');
		expect(code(() => log(600))).toBe('none');
		expect(code(() => log(1))).toBe('invalid');
		expect(code(() => log(5, NOON, 'nobody'))).toBe('not_found');
		expect(code(() => log(5, NOON, mum))).toBe('forbidden');
		expect(code(() => log(5, NOON, kid, 'nope'))).toBe('not_found');
		expect(code(() => log(5, NOON, bo, only.id))).toBe('forbidden');
		expect(code(() => log(5, NOON, kid, off.id))).toBe('forbidden');
	});
	it('writes nothing when the transaction fails', () => {
		expect(code(() => log(0))).toBe('invalid');
		expect(db.select().from(practiceLogs).all()).toHaveLength(0);
		expect(db.select().from(starTransactions).all()).toHaveLength(0);
	});
});

describe('undoing practice', () => {
	it('withdraws the stars, keeps the rows, and restores the summary', () => {
		const r = log(15);
		const u = undoPractice(db, r.log.id, { memberId: kid, now: NOON + 1000, byAdult: false });
		expect(u.log.status).toBe('undone');
		expect(u.summary).toMatchObject({ minutesToday: 0, starsToday: 0, lastLog: null });
		expect(balances(db)[kid] ?? 0).toBe(0);
		expect(
			db.select().from(starTransactions).where(eq(starTransactions.id, r.log.starTxId!)).get()
		).toMatchObject({ status: 'rejected' });
		expect(log(15).stars).toBe(1);
	});
	it('undoes a log that earned nothing', () => {
		const r = log(5);
		expect(r.log.starTxId).toBeNull();
		expect(undoPractice(db, r.log.id, { now: NOON, byAdult: false }).summary.minutesToday).toBe(0);
	});
	it('limits kids to the undo window, the newest log, and their own logs', () => {
		const a = log(10);
		const b = log(10);
		expect(code(() => undoPractice(db, a.log.id, { now: NOON, byAdult: false }))).toBe('conflict');
		expect(
			code(() => undoPractice(db, b.log.id, { now: NOON + KID_UNDO_WINDOW_MS + 1, byAdult: false }))
		).toBe('forbidden');
		expect(
			code(() => undoPractice(db, b.log.id, { memberId: 'other', now: NOON, byAdult: false }))
		).toBe('not_found');
		expect(code(() => undoPractice(db, 'nope', { now: NOON, byAdult: false }))).toBe('not_found');
		expect(
			code(() => undoPractice(db, b.log.id, { now: NOON + KID_UNDO_WINDOW_MS + 1, byAdult: true }))
		).toBe('none');
		expect(code(() => undoPractice(db, b.log.id, { now: NOON, byAdult: true }))).toBe('conflict');
	});
});

describe('the week', () => {
	it('sums active logs Monday to Sunday and leaves out undone ones', () => {
		log(15); // Monday 26 Oct
		const gone = log(30, NOON + 86_400_000);
		undoPractice(db, gone.log.id, { now: NOON + 86_400_000, byAdult: true });
		log(20, NOON + 2 * 86_400_000);
		log(45, NOON - 7 * 86_400_000); // last week
		const w = practiceWeek(db, kid, NOON + 2 * 86_400_000);
		expect(w.weekStart).toBe('2026-10-26');
		expect(w.today).toBe('2026-10-28');
		expect(w.days.map((d) => d.minutes)).toEqual([15, 0, 20, 0, 0, 0, 0]);
		expect(w.totalMinutes).toBe(35);
		expect(w.stars).toBe(2);
		expect(w.activityInfo[0].name).toBe(listPracticeActivities(db)[0].name);
		const before = practiceWeek(db, kid, NOON, '2026-10-20');
		expect(before.totalMinutes).toBe(45);
		expect(before.days.some((d) => d.isToday)).toBe(false);
	});
});
