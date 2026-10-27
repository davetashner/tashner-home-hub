/**
 * Money savings goals (hub-ar4). Progress is computed, never stored: min(allowance balance, price).
 * Buying a goal records a payout of its price on the allowance ledger, so the balance drops.
 */
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { goalProgress, parseGoalInput } from '#lib/domain/savings-goals.js';
import type { Db } from '../db/index.js';
import { members, savingsGoals } from '../db/schema.js';
import { allowanceBalance, recordPayout } from './allowance.js';
import { LedgerError } from './ledger.js';

export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type SavingsGoalView = SavingsGoal & {
	savedCents: number;
	reached: boolean;
};

function requireMember(db: Pick<Db, 'select'>, memberId: string) {
	if (!db.select().from(members).where(eq(members.id, memberId)).get())
		throw new LedgerError('not_found', 'Member not found');
}

function requireGoal(db: Pick<Db, 'select'>, memberId: string, goalId: string): SavingsGoal {
	const g = db
		.select()
		.from(savingsGoals)
		.where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.memberId, memberId)))
		.get();
	if (!g) throw new LedgerError('not_found', 'Goal not found');
	return g;
}

function requireActive(g: SavingsGoal): void {
	if (g.status !== 'active') throw new LedgerError('conflict', 'That goal is already finished.');
}

const view = (g: SavingsGoal, balance: number): SavingsGoalView => {
	// A bought goal is fully saved by definition; the money has since been paid out.
	const p = goalProgress(g.status === 'bought' ? g.targetCents : balance, g.targetCents);
	return { ...g, savedCents: p.savedCents, reached: p.reached };
};

/**
 * A member's goals (active first, current on top, then bought; archived are hidden) plus the
 * allowance balance the progress was computed from.
 */
export function listSavingsGoals(db: Db, memberId: string) {
	requireMember(db, memberId);
	const balanceCents = allowanceBalance(db, memberId);
	const rows = db
		.select()
		.from(savingsGoals)
		.where(and(eq(savingsGoals.memberId, memberId), ne(savingsGoals.status, 'archived')))
		.orderBy(asc(savingsGoals.status), desc(savingsGoals.current), asc(savingsGoals.createdAt))
		.all();
	return { balanceCents, goals: rows.map((g) => view(g, balanceCents)) };
}

/** The first active goal a member makes becomes their current one. */
export function createSavingsGoal(
	db: Db,
	memberId: string,
	input: unknown,
	now = Date.now()
): SavingsGoalView {
	const parsed = parseGoalInput(input, false);
	if (!parsed.ok) throw new LedgerError('invalid', parsed.error);
	return db.transaction((tx) => {
		requireMember(tx, memberId);
		const hasCurrent = !!tx
			.select({ id: savingsGoals.id })
			.from(savingsGoals)
			.where(and(eq(savingsGoals.memberId, memberId), eq(savingsGoals.current, true)))
			.get();
		const g = tx
			.insert(savingsGoals)
			.values({
				id: randomUUID(),
				memberId,
				title: parsed.value.title!,
				emoji: parsed.value.emoji ?? null,
				targetCents: parsed.value.targetCents!,
				current: !hasCurrent,
				createdAt: now
			})
			.returning()
			.get();
		return view(g, allowanceBalance(tx, memberId));
	});
}

/** Edits an active goal's name, emoji or price. */
export function updateSavingsGoal(
	db: Db,
	memberId: string,
	goalId: string,
	input: unknown
): SavingsGoalView {
	const parsed = parseGoalInput(input, true);
	if (!parsed.ok) throw new LedgerError('invalid', parsed.error);
	return db.transaction((tx) => {
		requireActive(requireGoal(tx, memberId, goalId));
		const g =
			Object.keys(parsed.value).length === 0
				? requireGoal(tx, memberId, goalId)
				: tx
						.update(savingsGoals)
						.set(parsed.value)
						.where(eq(savingsGoals.id, goalId))
						.returning()
						.get();
		return view(g, allowanceBalance(tx, memberId));
	});
}

/** Makes `goalId` the only current goal. */
export function setCurrentSavingsGoal(db: Db, memberId: string, goalId: string): SavingsGoalView {
	return db.transaction((tx) => {
		requireActive(requireGoal(tx, memberId, goalId));
		tx.update(savingsGoals)
			.set({ current: false })
			.where(eq(savingsGoals.memberId, memberId))
			.run();
		const g = tx
			.update(savingsGoals)
			.set({ current: true })
			.where(eq(savingsGoals.id, goalId))
			.returning()
			.get();
		return view(g, allowanceBalance(tx, memberId));
	});
}

/** Hides an active goal. If it was current, the oldest remaining active goal takes over. */
export function archiveSavingsGoal(db: Db, memberId: string, goalId: string): { id: string } {
	db.transaction((tx) => {
		const g = requireGoal(tx, memberId, goalId);
		requireActive(g);
		tx.update(savingsGoals)
			.set({ status: 'archived', current: false })
			.where(eq(savingsGoals.id, goalId))
			.run();
		if (g.current) promoteNext(tx, memberId);
	});
	return { id: goalId };
}

function promoteNext(tx: Pick<Db, 'select' | 'update'>, memberId: string): void {
	const next = tx
		.select()
		.from(savingsGoals)
		.where(and(eq(savingsGoals.memberId, memberId), eq(savingsGoals.status, 'active')))
		.orderBy(asc(savingsGoals.createdAt), asc(savingsGoals.id))
		.get();
	if (next)
		tx.update(savingsGoals).set({ current: true }).where(eq(savingsGoals.id, next.id)).run();
}

/**
 * A grown-up hands over the money: records a payout of the price on the allowance ledger and
 * marks the goal bought. Needs the balance to cover the price; all-or-nothing.
 */
export function markSavingsGoalBought(
	db: Db,
	memberId: string,
	goalId: string,
	now = Date.now()
): { goal: SavingsGoalView; balanceCents: number } {
	return db.transaction((tx) => {
		const g = requireGoal(tx, memberId, goalId);
		requireActive(g);
		if (allowanceBalance(tx, memberId) < g.targetCents)
			throw new LedgerError('conflict', 'Not enough saved yet.');
		const { balanceCents } = recordPayout(tx as unknown as Db, {
			memberId,
			cents: g.targetCents,
			note: `Bought: ${g.title}`,
			now
		});
		const bought = tx
			.update(savingsGoals)
			.set({ status: 'bought', current: false, boughtAt: now })
			.where(eq(savingsGoals.id, goalId))
			.returning()
			.get();
		if (g.current) promoteNext(tx, memberId);
		return { goal: view(bought, balanceCents), balanceCents };
	});
}
