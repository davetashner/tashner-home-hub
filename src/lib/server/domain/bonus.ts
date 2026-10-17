/**
 * Adult bonus stars and deductions (CHO-11). Rules live in `#lib/domain/bonus.js`; this writes the
 * ledger row. The balance is read and the row inserted in one transaction, so a deduction is
 * clamped against the true balance. See {@link planAdjustment} for the clamping rule.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { members, starTransactions } from '../db/schema.js';
import { planAdjustment } from '#lib/domain/bonus.js';
import { LedgerError, awardBonus, type StarTransaction } from './ledger.js';

export interface AdjustResult {
	transaction: StarTransaction;
	/** Balance after the change. */
	balance: number;
	/** True when a removal was cut down to what the child had. */
	clamped: boolean;
}

export function adjustStars(
	db: Db,
	input: { memberId: string; delta: unknown; note?: unknown; now?: number }
): AdjustResult {
	return db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, input.memberId)).get())
			throw new LedgerError('not_found', 'Member not found');
		const total = (): number =>
			(
				tx
					.select({ total: sql<number>`coalesce(sum(${starTransactions.delta}), 0)` })
					.from(starTransactions)
					.where(
						and(
							eq(starTransactions.memberId, input.memberId),
							eq(starTransactions.status, 'approved')
						)
					)
					.get() as { total: number }
			).total;
		const plan = planAdjustment({ delta: input.delta, note: input.note, balance: total() });
		if (!plan.ok) throw new LedgerError('invalid', plan.error);
		const transaction = awardBonus(tx as unknown as Db, {
			memberId: input.memberId,
			delta: plan.delta,
			note: plan.note,
			now: input.now
		});
		return { transaction, balance: total(), clamped: plan.clamped };
	});
}
