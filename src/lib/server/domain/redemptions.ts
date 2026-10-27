/**
 * Reward redemption + its log (requirement REW-4; §3.5, §7).
 *
 * Rules:
 * - Only an adult redeems; the caller passes the adult's id (`approvedBy`), the API
 *   guards the route with `requireAdult`.
 * - The balance must cover the reward's current cost. The check, the redemption row
 *   and the negative `redemption` ledger entry all happen in one IMMEDIATE transaction,
 *   so two taps can never spend the same stars twice.
 * - The balance is never stored: the debit is a ledger row like any other.
 * - The log reports the stars actually debited (from the ledger), not the reward's
 *   current cost, which an adult may have changed since.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { members, redemptions, rewards, starTransactions } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export type Redemption = typeof redemptions.$inferSelect;

export interface RedeemResult {
	redemption: Redemption;
	cost: number;
	/** The member's approved balance after the debit. */
	balance: number;
}

export interface RedemptionLogEntry {
	id: string;
	memberId: string;
	memberName: string;
	rewardId: string;
	rewardTitle: string;
	rewardImage: string | null;
	/** Stars debited (positive). */
	stars: number;
	approvedByName: string | null;
	createdAt: number;
}

type Reader = Pick<Db, 'select'>;

function approvedBalance(db: Reader, memberId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${starTransactions.delta}), 0)` })
		.from(starTransactions)
		.where(and(eq(starTransactions.memberId, memberId), eq(starTransactions.status, 'approved')))
		.get() as { total: number };
	return row.total;
}

/** Spends `memberId`'s stars on `rewardId`. Throws `conflict` when the balance is short. */
export function redeemReward(
	db: Db,
	input: { memberId: string; rewardId: string; approvedBy: string; now?: number }
): RedeemResult {
	const now = input.now ?? Date.now();
	return db.transaction((tx) => {
		const member = tx.select().from(members).where(eq(members.id, input.memberId)).get();
		if (!member) throw new LedgerError('not_found', 'Member not found');
		const reward = tx.select().from(rewards).where(eq(rewards.id, input.rewardId)).get();
		if (!reward || !reward.active || (reward.ownerId && reward.ownerId !== member.id))
			throw new LedgerError('not_found', 'Reward not found');
		const before = approvedBalance(tx, member.id);
		if (before < reward.cost)
			throw new LedgerError(
				'conflict',
				`Not enough stars: ${member.name} has ${before}, ${reward.title} costs ${reward.cost}`
			);
		const redemption = tx
			.insert(redemptions)
			.values({
				id: randomUUID(),
				rewardId: reward.id,
				memberId: member.id,
				approvedBy: input.approvedBy,
				createdAt: now
			})
			.returning()
			.get();
		tx.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId: member.id,
				delta: -reward.cost,
				reason: 'redemption',
				refId: redemption.id,
				note: reward.title,
				status: 'approved',
				createdAt: now
			})
			.run();
		return { redemption, cost: reward.cost, balance: before - reward.cost };
	});
}

/** Redemptions newest first, optionally for one member. */
export function redemptionLog(
	db: Db,
	opts: { memberId?: string; limit?: number } = {}
): RedemptionLogEntry[] {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const approver = alias(members, 'approver');
	return db
		.select({
			id: redemptions.id,
			memberId: redemptions.memberId,
			memberName: members.name,
			rewardId: redemptions.rewardId,
			rewardTitle: rewards.title,
			rewardImage: rewards.image,
			stars: sql<number>`coalesce(-${starTransactions.delta}, ${rewards.cost})`,
			approvedByName: approver.name,
			createdAt: redemptions.createdAt
		})
		.from(redemptions)
		.innerJoin(members, eq(members.id, redemptions.memberId))
		.innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
		.leftJoin(approver, eq(approver.id, redemptions.approvedBy))
		.leftJoin(
			starTransactions,
			and(eq(starTransactions.refId, redemptions.id), eq(starTransactions.reason, 'redemption'))
		)
		.where(opts.memberId === undefined ? undefined : eq(redemptions.memberId, opts.memberId))
		.orderBy(desc(redemptions.createdAt), desc(redemptions.id))
		.limit(limit)
		.all();
}
