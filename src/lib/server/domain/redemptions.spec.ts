import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { LedgerError, awardBonus, history } from './ledger.js';
import { redeemReward, redemptionLog } from './redemptions.js';
import { archiveReward, createReward, updateReward } from './rewards.js';
import { starBalance } from './stars.js';

let db: Db;
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
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Kid A', role: 'child', color: 'blue' },
			{ id: 'sib', name: 'Kid B', role: 'child', color: 'blue' },
			{ id: 'grown', name: 'Grown Up', role: 'adult', color: 'blue' }
		])
		.run();
});

describe('redeemReward', () => {
	it('debits the cost through the ledger and logs the redemption', () => {
		const r = createReward(db, { title: 'Ice cream', cost: 20, image: '🍦' });
		awardBonus(db, { memberId: 'kid', delta: 25, note: 'seed', now: 1 });
		const res = redeemReward(db, {
			memberId: 'kid',
			rewardId: r.id,
			approvedBy: 'grown',
			now: 1000
		});
		expect(res).toMatchObject({ cost: 20, balance: 5 });
		expect(res.redemption).toMatchObject({
			memberId: 'kid',
			rewardId: r.id,
			approvedBy: 'grown',
			createdAt: 1000
		});
		expect(starBalance(db, 'kid')).toBe(5);
		const [debit] = history(db, 'kid');
		expect(debit).toMatchObject({
			delta: -20,
			reason: 'redemption',
			refId: res.redemption.id,
			note: 'Ice cream',
			status: 'approved'
		});
	});

	it('allows spending the exact balance, then refuses when short', () => {
		const r = createReward(db, { title: 'Park', cost: 10 });
		awardBonus(db, { memberId: 'kid', delta: 10, note: 'seed' });
		expect(redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' }).balance).toBe(
			0
		);
		expect(
			code(() => redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' }))
		).toBe('conflict');
		expect(starBalance(db, 'kid')).toBe(0);
		expect(redemptionLog(db)).toHaveLength(1);
	});

	it('ignores pending stars', () => {
		const r = createReward(db, { title: 'Park', cost: 5 });
		db.insert(schema.starTransactions)
			.values({ id: 'p', memberId: 'kid', delta: 50, reason: 'chore', status: 'pending' })
			.run();
		expect(
			code(() => redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' }))
		).toBe('conflict');
	});

	it('rejects unknown members and unknown or archived rewards', () => {
		const r = createReward(db, { title: 'Park', cost: 1 });
		awardBonus(db, { memberId: 'kid', delta: 5, note: 'seed' });
		expect(
			code(() => redeemReward(db, { memberId: 'nope', rewardId: r.id, approvedBy: 'grown' }))
		).toBe('not_found');
		expect(
			code(() => redeemReward(db, { memberId: 'kid', rewardId: 'nope', approvedBy: 'grown' }))
		).toBe('not_found');
		archiveReward(db, r.id);
		expect(
			code(() => redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' }))
		).toBe('not_found');
		expect(starBalance(db, 'kid')).toBe(5);
	});
});

describe('redemptionLog', () => {
	it('lists newest first with names, filters by member, and keeps the debited stars', () => {
		const small = createReward(db, { title: 'Sticker', cost: 2, image: '⭐' });
		const big = createReward(db, { title: 'LEGO', cost: 8 });
		awardBonus(db, { memberId: 'kid', delta: 20, note: 'seed' });
		awardBonus(db, { memberId: 'sib', delta: 20, note: 'seed' });
		redeemReward(db, { memberId: 'kid', rewardId: small.id, approvedBy: 'grown', now: 100 });
		redeemReward(db, { memberId: 'sib', rewardId: big.id, approvedBy: 'grown', now: 200 });
		redeemReward(db, { memberId: 'kid', rewardId: big.id, approvedBy: 'grown', now: 300 });
		updateReward(db, big.id, { cost: 50 });

		const all = redemptionLog(db);
		expect(all.map((e) => [e.memberName, e.rewardTitle, e.stars, e.createdAt])).toEqual([
			['Kid A', 'LEGO', 8, 300],
			['Kid B', 'LEGO', 8, 200],
			['Kid A', 'Sticker', 2, 100]
		]);
		expect(all[2]).toMatchObject({ rewardImage: '⭐', approvedByName: 'Grown Up' });
		expect(redemptionLog(db, { memberId: 'sib' })).toHaveLength(1);
		expect(redemptionLog(db, { limit: 0 })).toHaveLength(1);
		expect(redemptionLog(db, { limit: 2 })).toHaveLength(2);
	});

	it('survives a removed approver and an archived reward', () => {
		const r = createReward(db, { title: 'Park', cost: 3 });
		awardBonus(db, { memberId: 'kid', delta: 3, note: 'seed' });
		redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' });
		archiveReward(db, r.id);
		db.delete(schema.members).where(eq(schema.members.id, 'grown')).run();
		expect(redemptionLog(db)[0]).toMatchObject({
			rewardTitle: 'Park',
			approvedByName: null,
			stars: 3
		});
	});
});
