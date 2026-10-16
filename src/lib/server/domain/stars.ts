import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { starTransactions } from '../db/schema.js';

/**
 * A member's star balance, computed from the ledger. Never stored.
 * Only approved transactions count; redemptions are negative deltas.
 */
export function starBalance(db: Db, memberId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${starTransactions.delta}), 0)` })
		.from(starTransactions)
		.where(and(eq(starTransactions.memberId, memberId), eq(starTransactions.status, 'approved')))
		.get() as { total: number }; // aggregate without GROUP BY always yields one row
	return row.total;
}
