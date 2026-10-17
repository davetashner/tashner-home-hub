import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { choreCompletions, goals, rewards } from '../db/schema.js';
import { balances } from './ledger.js';

export interface AttentionCount {
	/** Chore completions waiting for a grown-up to approve. */
	pending: number;
	/** Kids whose active goal is reached (ledger balance >= cost), ready to redeem. */
	ready: number;
	/** pending + ready: what the header badge shows. */
	total: number;
}

/**
 * Everything that needs a grown-up, in one place so the header badge and the approvals
 * screen cannot disagree. Balances are computed from the ledger, never stored.
 */
export function attentionCount(db: Db): AttentionCount {
	const pending =
		db
			.select({ n: count() })
			.from(choreCompletions)
			.where(eq(choreCompletions.status, 'pending'))
			.get()?.n ?? 0;

	const active = db
		.select({ memberId: goals.memberId, cost: rewards.cost })
		.from(goals)
		.innerJoin(rewards, eq(goals.rewardId, rewards.id))
		.where(eq(rewards.active, true))
		.all();
	const balance = balances(db);
	const ready = active.filter((g) => (balance[g.memberId] ?? 0) >= g.cost).length;

	return { pending, ready, total: pending + ready };
}
