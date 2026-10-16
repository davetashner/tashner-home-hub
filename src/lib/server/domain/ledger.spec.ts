import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import { starBalance } from './stars.js';
import {
	KID_UNDO_WINDOW_MS,
	LedgerError,
	approveCompletion,
	awardBonus,
	balances,
	completeChore,
	createChore,
	history,
	pendingApprovals,
	pendingStars,
	recentCompletions,
	rejectCompletion,
	undoCompletion
} from './ledger.js';

const T0 = 1_700_000_000_000;
const DAY = '2026-01-05';
let db: Db;
let kid: string;

function addMember(id: string, role: 'adult' | 'child' = 'child') {
	db.insert(schema.members)
		.values({ id, name: `Test ${id}`, role, color: 'blue' })
		.run();
	return id;
}
const done = (choreId: string, now = T0, date = DAY, memberId = kid) =>
	completeChore(db, { choreId, memberId, date, now });
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as LedgerError).code;
	}
	return 'none';
};

beforeEach(() => {
	db = openDb(':memory:');
	kid = addMember('kid');
});

describe('createChore', () => {
	it('requires approval by default and honours explicit false', () => {
		expect(createChore(db, { title: 'Dishes' }).requiresApproval).toBe(true);
		const c = createChore(db, {
			title: 'Toys',
			stars: 3,
			requiresApproval: false,
			memberIds: [kid],
			icon: 'x',
			schedule: 'FREQ=DAILY',
			timeOfDay: 'am'
		});
		expect(c).toMatchObject({ requiresApproval: false, stars: 3, schedule: 'FREQ=DAILY' });
	});
});

describe('completeChore', () => {
	it('approval flow: pending until approved, never in balance while pending', () => {
		const chore = createChore(db, { title: 'Dishes', stars: 2 });
		const { completion, created } = done(chore.id);
		expect(created).toBe(true);
		expect(completion).toMatchObject({ status: 'pending', starsAwarded: 2 });
		expect(starBalance(db, kid)).toBe(0);
		expect(balances(db)[kid]).toBe(0);
		expect(pendingStars(db, kid)).toBe(2);
		expect(pendingApprovals(db)).toHaveLength(1);

		approveCompletion(db, completion.id);
		expect(balances(db)[kid]).toBe(2);
		expect(pendingStars(db, kid)).toBe(0);
		expect(pendingApprovals(db)).toHaveLength(0);
	});

	it('no-approval flow: approved immediately', () => {
		const chore = createChore(db, { title: 'Toys', requiresApproval: false });
		expect(done(chore.id).completion.status).toBe('approved');
		expect(balances(db)[kid]).toBe(1);
		expect(pendingStars(db, kid)).toBe(0);
	});

	it('is idempotent per chore/member/day', () => {
		const chore = createChore(db, { title: 'Toys', requiresApproval: false });
		const a = done(chore.id);
		const b = done(chore.id, T0 + 5);
		expect(b.created).toBe(false);
		expect(b.completion.id).toBe(a.completion.id);
		expect(balances(db)[kid]).toBe(1);
		expect(history(db, kid)).toHaveLength(1);
		// a different day is a new completion
		expect(done(chore.id, T0, '2026-01-06').created).toBe(true);
	});

	it('allows a redo after undo or reject', () => {
		const chore = createChore(db, { title: 'Dishes' });
		const a = done(chore.id).completion;
		undoCompletion(db, a.id, { now: T0 + 1, byAdult: false });
		const b = done(chore.id, T0 + 2);
		expect(b.created).toBe(true);
		rejectCompletion(db, b.completion.id);
		expect(done(chore.id, T0 + 3).created).toBe(true);
	});

	it('rejects unknown/archived chores and unknown members; rolls back', () => {
		const chore = createChore(db, { title: 'Dishes' });
		expect(code(() => done('nope'))).toBe('not_found');
		expect(code(() => done(chore.id, T0, DAY, 'ghost'))).toBe('not_found');
		db.update(schema.chores).set({ archived: true }).where(eq(schema.chores.id, chore.id)).run();
		expect(code(() => done(chore.id))).toBe('not_found');
	});

	it('rolls back the completion if the ledger insert fails', () => {
		const chore = createChore(db, { title: 'Dishes' });
		db.$client.exec(
			`CREATE TRIGGER fail_tx BEFORE INSERT ON star_transactions BEGIN SELECT RAISE(ABORT, 'boom'); END`
		);
		expect(() => done(chore.id)).toThrow(/boom/);
		expect(db.select().from(schema.choreCompletions).all()).toHaveLength(0);
	});
});

describe('undoCompletion', () => {
	it('lets a kid undo within 10 s, keeps audit rows', () => {
		const chore = createChore(db, { title: 'Toys', requiresApproval: false });
		const c = done(chore.id).completion;
		const u = undoCompletion(db, c.id, { now: T0 + KID_UNDO_WINDOW_MS, byAdult: false });
		expect(u.status).toBe('undone');
		expect(balances(db)[kid]).toBe(0);
		const rows = history(db, kid);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('rejected');
	});

	it('blocks a kid after 10 s but allows an adult any time', () => {
		const chore = createChore(db, { title: 'Toys', requiresApproval: false });
		const c = done(chore.id).completion;
		const late = T0 + KID_UNDO_WINDOW_MS + 1;
		expect(code(() => undoCompletion(db, c.id, { now: late, byAdult: false }))).toBe('forbidden');
		expect(undoCompletion(db, c.id, { now: late, byAdult: true }).status).toBe('undone');
	});

	it('errors for missing or already-finished completions', () => {
		expect(code(() => undoCompletion(db, 'x', { now: T0, byAdult: true }))).toBe('not_found');
		const c = done(createChore(db, { title: 'D' }).id).completion;
		undoCompletion(db, c.id, { now: T0, byAdult: true });
		expect(code(() => undoCompletion(db, c.id, { now: T0, byAdult: true }))).toBe('conflict');
	});
});

describe('recentCompletions', () => {
	it('lists approved completions since a time, newest first, and drops undone ones', () => {
		const bed = createChore(db, { title: 'Bed', stars: 2, requiresApproval: false });
		const fish = createChore(db, { title: 'Fish', requiresApproval: false });
		const dishes = createChore(db, { title: 'Dishes' });
		done(bed.id, T0 - 10_000, '2026-01-04');
		const recentBed = done(bed.id, T0 + 1).completion;
		const f = done(fish.id, T0 + 2).completion;
		done(dishes.id, T0 + 3); // pending: not listed
		const list = recentCompletions(db, { since: T0 });
		expect(list.map((r) => r.choreTitle)).toEqual(['Fish', 'Bed']);
		expect(list[1]).toMatchObject({
			completionId: recentBed.id,
			memberName: `Test ${kid}`,
			stars: 2
		});
		expect(recentCompletions(db, { since: 0, limit: 1 })).toHaveLength(1);
		expect(recentCompletions(db, { since: 0, limit: 0 })).toHaveLength(1);

		undoCompletion(db, f.id, { now: T0 + 999_999, byAdult: true });
		expect(recentCompletions(db, { since: T0 }).map((r) => r.choreTitle)).toEqual(['Bed']);
		expect(balances(db)[kid]).toBe(4);
	});
});

describe('approve / reject', () => {
	it('reject stores the note and never counts', () => {
		const c = done(createChore(db, { title: 'D', stars: 3 }).id).completion;
		expect(rejectCompletion(db, c.id, { note: 'not tidy' }).status).toBe('rejected');
		const [row] = history(db, kid);
		expect(row).toMatchObject({ status: 'rejected', note: 'not tidy' });
		expect(balances(db)[kid]).toBe(0);
		expect(pendingStars(db, kid)).toBe(0);
	});

	it('reject without a note leaves note null; only pending can transition', () => {
		const c = done(createChore(db, { title: 'D' }).id).completion;
		rejectCompletion(db, c.id);
		expect(history(db, kid)[0].note).toBeNull();
		expect(code(() => approveCompletion(db, c.id))).toBe('conflict');
		expect(code(() => rejectCompletion(db, 'missing'))).toBe('not_found');
	});
});

describe('awardBonus', () => {
	it('adds bonuses and deductions; validates input', () => {
		expect(awardBonus(db, { memberId: kid, delta: 5, note: 'nice' }).reason).toBe('bonus');
		expect(awardBonus(db, { memberId: kid, delta: -2, note: 'oops', now: T0 }).reason).toBe(
			'adjustment'
		);
		expect(balances(db)[kid]).toBe(3);
		expect(code(() => awardBonus(db, { memberId: kid, delta: 0, note: 'x' }))).toBe('invalid');
		expect(code(() => awardBonus(db, { memberId: kid, delta: 1.5, note: 'x' }))).toBe('invalid');
		expect(code(() => awardBonus(db, { memberId: 'ghost', delta: 1, note: 'x' }))).toBe(
			'not_found'
		);
	});
});

describe('queries', () => {
	it('history is newest-first, paginates, and clamps limit', () => {
		for (let i = 1; i <= 5; i++)
			awardBonus(db, { memberId: kid, delta: i, note: `n${i}`, now: T0 + i });
		const page1 = history(db, kid, { limit: 2 });
		expect(page1.map((r) => r.delta)).toEqual([5, 4]);
		const page2 = history(db, kid, { limit: 2, before: page1[1].createdAt });
		expect(page2.map((r) => r.delta)).toEqual([3, 2]);
		expect(history(db, kid, { limit: 0 })).toHaveLength(1);
		expect(history(db, kid)).toHaveLength(5);
	});

	it('balances are per member and include zero-balance members; pending approvals ordered', () => {
		const other = addMember('other');
		awardBonus(db, { memberId: other, delta: 4, note: 'x' });
		const chore = createChore(db, { title: 'D' });
		const later = done(chore.id, T0 + 10).completion;
		const earlier = done(chore.id, T0 + 1, DAY, other).completion;
		expect(balances(db)).toEqual({ kid: 0, other: 4 });
		expect(pendingApprovals(db).map((p) => p.completionId)).toEqual([earlier.id, later.id]);
		expect(pendingApprovals(db)[0]).toMatchObject({ memberName: 'Test other', choreTitle: 'D' });
	});
});
