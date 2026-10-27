import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../db/index.js';
import { allowanceTransactions, members } from '../db/schema.js';
import { allowanceBalance } from './allowance.js';
import {
	archiveSavingsGoal,
	createSavingsGoal,
	listSavingsGoals,
	markSavingsGoalBought,
	setCurrentSavingsGoal,
	updateSavingsGoal
} from './savings-goals.js';

let db: Db;
const KID = 'kid-1';
const OTHER = 'kid-2';

function fund(memberId: string, cents: number) {
	db.insert(allowanceTransactions)
		.values({ id: crypto.randomUUID(), memberId, cents, kind: 'adjustment', note: 'seed' })
		.run();
}
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members)
		.values([
			{ id: KID, name: 'Kid One', role: 'child', color: 'member-1' },
			{ id: OTHER, name: 'Kid Two', role: 'child', color: 'member-2' }
		])
		.run();
});

describe('savings goals', () => {
	it('makes the first goal current and later ones not', () => {
		const a = createSavingsGoal(db, KID, { title: 'Bike', emoji: '🚲', targetCents: 10000 });
		const b = createSavingsGoal(db, KID, { title: 'Lego', targetCents: 4000 });
		expect(a.current).toBe(true);
		expect(b.current).toBe(false);
		expect(b.emoji).toBeNull();
	});

	it('computes progress from the ledger, capped at the price', () => {
		createSavingsGoal(db, KID, { title: 'Lego', targetCents: 4000 });
		fund(KID, 1500);
		let l = listSavingsGoals(db, KID);
		expect(l.balanceCents).toBe(1500);
		expect(l.goals[0]).toMatchObject({ savedCents: 1500, targetCents: 4000, reached: false });
		fund(KID, 9000);
		l = listSavingsGoals(db, KID);
		expect(l.goals[0]).toMatchObject({ savedCents: 4000, reached: true });
		fund(OTHER, 99999);
		expect(listSavingsGoals(db, KID).balanceCents).toBe(10500);
	});

	it('validates input and member', () => {
		expect(code(() => createSavingsGoal(db, KID, { title: '', targetCents: 500 }))).toBe('invalid');
		expect(code(() => createSavingsGoal(db, 'nobody', { title: 'a', targetCents: 500 }))).toBe(
			'not_found'
		);
		expect(code(() => listSavingsGoals(db, 'nobody'))).toBe('not_found');
	});

	it('edits only active goals owned by the member', () => {
		const a = createSavingsGoal(db, KID, { title: 'Bike', targetCents: 10000 });
		expect(
			updateSavingsGoal(db, KID, a.id, { title: 'Red bike', targetCents: 9000 })
		).toMatchObject({
			title: 'Red bike',
			targetCents: 9000
		});
		expect(updateSavingsGoal(db, KID, a.id, {}).title).toBe('Red bike');
		expect(code(() => updateSavingsGoal(db, KID, a.id, { targetCents: 1 }))).toBe('invalid');
		expect(code(() => updateSavingsGoal(db, OTHER, a.id, { title: 'x' }))).toBe('not_found');
		archiveSavingsGoal(db, KID, a.id);
		expect(code(() => updateSavingsGoal(db, KID, a.id, { title: 'x' }))).toBe('conflict');
	});

	it('keeps exactly one current goal', () => {
		const a = createSavingsGoal(db, KID, { title: 'A', targetCents: 500 });
		const b = createSavingsGoal(db, KID, { title: 'B', targetCents: 500 });
		expect(setCurrentSavingsGoal(db, KID, b.id).current).toBe(true);
		const goals = listSavingsGoals(db, KID).goals;
		expect(goals.filter((g) => g.current).map((g) => g.id)).toEqual([b.id]);
		expect(code(() => setCurrentSavingsGoal(db, OTHER, a.id))).toBe('not_found');
	});

	it('archiving hides the goal and hands current to the next oldest', () => {
		const a = createSavingsGoal(db, KID, { title: 'A', targetCents: 500 }, 1);
		const b = createSavingsGoal(db, KID, { title: 'B', targetCents: 500 }, 2);
		createSavingsGoal(db, KID, { title: 'C', targetCents: 500 }, 3);
		archiveSavingsGoal(db, KID, a.id);
		const goals = listSavingsGoals(db, KID).goals;
		expect(goals.map((g) => g.title).sort()).toEqual(['B', 'C']);
		expect(goals.find((g) => g.current)?.id).toBe(b.id);
		expect(code(() => archiveSavingsGoal(db, KID, a.id))).toBe('conflict');
		archiveSavingsGoal(db, KID, b.id);
		archiveSavingsGoal(db, KID, goals.find((g) => g.title === 'C')!.id);
		expect(listSavingsGoals(db, KID).goals).toEqual([]);
	});

	it('buying pays out the price, drops the balance and promotes the next goal', () => {
		const a = createSavingsGoal(db, KID, { title: 'Lego', targetCents: 4000 }, 1);
		const b = createSavingsGoal(db, KID, { title: 'Bike', targetCents: 9000 }, 2);
		expect(code(() => markSavingsGoalBought(db, KID, a.id))).toBe('conflict');
		fund(KID, 5000);
		const r = markSavingsGoalBought(db, KID, a.id, 777);
		expect(r.balanceCents).toBe(1000);
		expect(r.goal).toMatchObject({
			status: 'bought',
			current: false,
			boughtAt: 777,
			savedCents: 4000
		});
		expect(allowanceBalance(db, KID)).toBe(1000);
		const payout = db
			.select()
			.from(allowanceTransactions)
			.where(eq(allowanceTransactions.kind, 'payout'))
			.get();
		expect(payout).toMatchObject({ cents: -4000, note: 'Bought: Lego' });
		const goals = listSavingsGoals(db, KID).goals;
		expect(goals.map((g) => g.title)).toEqual(['Bike', 'Lego']);
		expect(goals[0]).toMatchObject({ id: b.id, current: true, savedCents: 1000 });
		expect(code(() => markSavingsGoalBought(db, KID, a.id))).toBe('conflict');
		expect(code(() => markSavingsGoalBought(db, OTHER, b.id))).toBe('not_found');
	});

	it('buying a non-current goal leaves current alone', () => {
		createSavingsGoal(db, KID, { title: 'A', targetCents: 9000 });
		const b = createSavingsGoal(db, KID, { title: 'B', targetCents: 500 });
		fund(KID, 600);
		markSavingsGoalBought(db, KID, b.id);
		expect(listSavingsGoals(db, KID).goals.find((g) => g.title === 'A')?.current).toBe(true);
	});
});
