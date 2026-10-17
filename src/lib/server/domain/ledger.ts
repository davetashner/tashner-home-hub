/**
 * Star ledger + chore completion history (requirements CHO-5, CHO-6, CHO-8, CHO-9; §7).
 *
 * Rules:
 * - Ledger rows are never deleted. Undo/reject mark the transaction `rejected` for audit.
 * - Only `approved` transactions count toward a balance.
 * - Every multi-row write runs in a single DB transaction.
 * - Parent approval is ON by default: chores created without an explicit
 *   `requiresApproval` require it (see {@link createChore}). The schema default is
 *   false and is frozen, so the default is applied here, in the creation code path.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, members, starTransactions } from '../db/schema.js';

export type Completion = typeof choreCompletions.$inferSelect;
export type StarTransaction = typeof starTransactions.$inferSelect;
export type Chore = typeof chores.$inferSelect;

/** A kid may undo their own tap only within this window. */
export const KID_UNDO_WINDOW_MS = 10_000;

export type LedgerErrorCode = 'not_found' | 'forbidden' | 'conflict' | 'invalid';

export class LedgerError extends Error {
	constructor(
		readonly code: LedgerErrorCode,
		message: string
	) {
		super(message);
		this.name = 'LedgerError';
	}
}

/** Creates a chore. Approval is required unless explicitly set to `false` (owner default). */
export function createChore(
	db: Db,
	input: {
		title: string;
		kind?: 'star_job' | 'habit';
		stars?: number;
		memberIds?: string[];
		icon?: string | null;
		schedule?: string | null;
		timeOfDay?: string | null;
		requiresApproval?: boolean;
	}
): Chore {
	return db
		.insert(chores)
		.values({
			id: randomUUID(),
			title: input.title,
			kind: input.kind ?? 'star_job',
			stars: input.stars ?? 1,
			memberIds: JSON.stringify(input.memberIds ?? []),
			icon: input.icon ?? null,
			schedule: input.schedule ?? null,
			timeOfDay: input.timeOfDay ?? null,
			requiresApproval: input.requiresApproval ?? true
		})
		.returning()
		.get();
}

export interface CompleteResult {
	completion: Completion;
	/** False when an existing same-day completion was returned instead of a new one. */
	created: boolean;
}

export function completeChore(
	db: Db,
	input: { choreId: string; memberId: string; date: string; now: number }
): CompleteResult {
	return db.transaction((tx) => {
		const chore = tx.select().from(chores).where(eq(chores.id, input.choreId)).get();
		if (!chore || chore.archived) throw new LedgerError('not_found', 'Star Job not found');
		const member = tx.select().from(members).where(eq(members.id, input.memberId)).get();
		if (!member) throw new LedgerError('not_found', 'Member not found');

		const existing = tx
			.select()
			.from(choreCompletions)
			.where(
				and(
					eq(choreCompletions.choreId, input.choreId),
					eq(choreCompletions.memberId, input.memberId),
					eq(choreCompletions.date, input.date)
				)
			)
			.all()
			.find((c) => c.status === 'pending' || c.status === 'approved');
		if (existing) return { completion: existing, created: false };

		// A habit is a plain check: no approval, and no ledger row (its daily star is separate).
		const habit = chore.kind === 'habit';
		const status = chore.requiresApproval && !habit ? 'pending' : 'approved';
		const completion = tx
			.insert(choreCompletions)
			.values({
				id: randomUUID(),
				choreId: chore.id,
				memberId: member.id,
				date: input.date,
				completedAt: input.now,
				status,
				starsAwarded: habit ? 0 : chore.stars
			})
			.returning()
			.get();
		if (habit) return { completion, created: true };
		tx.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId: member.id,
				delta: chore.stars,
				reason: 'chore',
				refId: completion.id,
				status,
				createdAt: input.now
			})
			.run();
		return { completion, created: true };
	});
}

function setStatus(
	db: Db,
	completionId: string,
	from: Completion['status'][],
	to: Completion['status'],
	txStatus: StarTransaction['status'],
	note?: string
): Completion {
	return db.transaction((tx) => {
		const c = tx.select().from(choreCompletions).where(eq(choreCompletions.id, completionId)).get();
		if (!c) throw new LedgerError('not_found', 'Completion not found');
		if (!from.includes(c.status))
			throw new LedgerError('conflict', `Completion is ${c.status}, cannot become ${to}`);
		const updated = tx
			.update(choreCompletions)
			.set({ status: to })
			.where(eq(choreCompletions.id, completionId))
			.returning()
			.get();
		tx.update(starTransactions)
			.set(note === undefined ? { status: txStatus } : { status: txStatus, note })
			.where(and(eq(starTransactions.refId, completionId), eq(starTransactions.reason, 'chore')))
			.run();
		return updated;
	});
}

/** Kid undo: within 10 s of completedAt. Adults: any time (pending or approved). */
export function undoCompletion(
	db: Db,
	completionId: string,
	opts: { now: number; byAdult: boolean }
): Completion {
	const c = db.select().from(choreCompletions).where(eq(choreCompletions.id, completionId)).get();
	if (!c) throw new LedgerError('not_found', 'Completion not found');
	if (!opts.byAdult && opts.now - c.completedAt > KID_UNDO_WINDOW_MS)
		throw new LedgerError('forbidden', 'Undo window has passed; ask a grown-up');
	return setStatus(db, completionId, ['pending', 'approved'], 'undone', 'rejected');
}

export function approveCompletion(db: Db, completionId: string): Completion {
	return setStatus(db, completionId, ['pending'], 'approved', 'approved');
}

export function rejectCompletion(db: Db, completionId: string, opts: { note?: string } = {}) {
	return setStatus(db, completionId, ['pending'], 'rejected', 'rejected', opts.note);
}

/** Adult bonus (positive) or deduction (negative). Applied immediately. */
export function awardBonus(
	db: Db,
	input: { memberId: string; delta: number; note: string; now?: number }
): StarTransaction {
	if (!Number.isInteger(input.delta) || input.delta === 0)
		throw new LedgerError('invalid', 'delta must be a non-zero integer');
	return db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, input.memberId)).get())
			throw new LedgerError('not_found', 'Member not found');
		return tx
			.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId: input.memberId,
				delta: input.delta,
				reason: input.delta > 0 ? 'bonus' : 'adjustment',
				note: input.note,
				status: 'approved',
				...(input.now === undefined ? {} : { createdAt: input.now })
			})
			.returning()
			.get();
	});
}

export interface PendingApproval {
	completionId: string;
	memberId: string;
	memberName: string;
	choreId: string;
	choreTitle: string;
	choreIcon: string | null;
	stars: number;
	date: string;
	completedAt: number;
}

const approvalFields = {
	completionId: choreCompletions.id,
	memberId: choreCompletions.memberId,
	memberName: members.name,
	choreId: choreCompletions.choreId,
	choreTitle: chores.title,
	choreIcon: chores.icon,
	stars: choreCompletions.starsAwarded,
	date: choreCompletions.date,
	completedAt: choreCompletions.completedAt
};

/**
 * Approved completions since `since` (ms), newest first, so a grown-up can undo any of them
 * later (CHO-6). Undoing one marks its star transaction `rejected`, so the balance drops.
 */
export function recentCompletions(
	db: Db,
	opts: { since: number; limit?: number }
): PendingApproval[] {
	const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
	return db
		.select(approvalFields)
		.from(choreCompletions)
		.innerJoin(members, eq(members.id, choreCompletions.memberId))
		.innerJoin(chores, eq(chores.id, choreCompletions.choreId))
		.where(
			and(eq(choreCompletions.status, 'approved'), gte(choreCompletions.completedAt, opts.since))
		)
		.orderBy(desc(choreCompletions.completedAt), desc(choreCompletions.id))
		.limit(limit)
		.all();
}

/** Completions awaiting a grown-up, oldest first. */
export function pendingApprovals(db: Db): PendingApproval[] {
	return db
		.select(approvalFields)
		.from(choreCompletions)
		.innerJoin(members, eq(members.id, choreCompletions.memberId))
		.innerJoin(chores, eq(chores.id, choreCompletions.choreId))
		.where(eq(choreCompletions.status, 'pending'))
		.orderBy(choreCompletions.completedAt, choreCompletions.id)
		.all();
}

/** Star transactions for a member, newest first. `before` is an exclusive createdAt cursor. */
export function history(
	db: Db,
	memberId: string,
	opts: { limit?: number; before?: number } = {}
): StarTransaction[] {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	return db
		.select()
		.from(starTransactions)
		.where(
			opts.before === undefined
				? eq(starTransactions.memberId, memberId)
				: and(eq(starTransactions.memberId, memberId), lt(starTransactions.createdAt, opts.before))
		)
		.orderBy(desc(starTransactions.createdAt), desc(starTransactions.id))
		.limit(limit)
		.all();
}

/** Approved balance per member (members with no transactions are 0). */
export function balances(db: Db): Record<string, number> {
	const rows = db
		.select({
			memberId: members.id,
			total: sql<number>`coalesce(sum(case when ${starTransactions.status} = 'approved' then ${starTransactions.delta} else 0 end), 0)`
		})
		.from(members)
		.leftJoin(starTransactions, eq(starTransactions.memberId, members.id))
		.groupBy(members.id)
		.all();
	return Object.fromEntries(rows.map((r) => [r.memberId, r.total]));
}

/** Stars awaiting approval ("waiting for grown-up"). */
export function pendingStars(db: Db, memberId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${starTransactions.delta}), 0)` })
		.from(starTransactions)
		.where(and(eq(starTransactions.memberId, memberId), eq(starTransactions.status, 'pending')))
		.get() as { total: number };
	return row.total;
}
