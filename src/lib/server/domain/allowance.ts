/**
 * The allowance ledger (requirement REW-7). Stars convert to money at an adult-set rate.
 *
 * Rules:
 * - Money is integer cents. The balance is never stored: it is the sum of the ledger.
 * - A cash-out writes a star debit (`cashout`) and an allowance credit in one IMMEDIATE
 *   transaction, so two taps can never spend the same stars twice.
 * - A payout debits money handed over and cannot exceed the balance. Adjustments are signed,
 *   carry a note, and may not take the balance below zero.
 * - Rows are never deleted.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	DEFAULT_RATE,
	parseRate,
	planAdjustment,
	planCashout,
	planPayout,
	type AllowanceRate
} from '#lib/domain/allowance.js';
import type { Db } from '../db/index.js';
import { allowanceTransactions, members, settings, starTransactions } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { starBalance } from './stars.js';

export const ALLOWANCE_RATE_KEY = 'allowance.rate';

export type AllowanceEntry = typeof allowanceTransactions.$inferSelect;

/** The saved rate; missing or corrupt reads as the default (10 stars = $1.00). */
export function getRate(db: Db): AllowanceRate {
	const row = db.select().from(settings).where(eq(settings.key, ALLOWANCE_RATE_KEY)).get();
	if (!row) return DEFAULT_RATE;
	try {
		const parsed = parseRate(JSON.parse(row.value));
		return parsed.ok ? parsed.rate : DEFAULT_RATE;
	} catch {
		return DEFAULT_RATE;
	}
}

export function setRate(db: Db, input: unknown): AllowanceRate {
	const parsed = parseRate(input);
	if (!parsed.ok) throw new LedgerError('invalid', parsed.error);
	const value = JSON.stringify(parsed.rate);
	db.insert(settings)
		.values({ key: ALLOWANCE_RATE_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return parsed.rate;
}

type Reader = Pick<Db, 'select'>;

/** A member's money balance in cents, computed from the ledger. */
export function allowanceBalance(db: Reader, memberId: string): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${allowanceTransactions.cents}), 0)` })
		.from(allowanceTransactions)
		.where(eq(allowanceTransactions.memberId, memberId))
		.get() as { total: number };
	return row.total;
}

/** Cents balance for every member (0 when they have no entries). */
export function allowanceBalances(db: Db): Record<string, number> {
	const rows = db
		.select({
			memberId: members.id,
			total: sql<number>`coalesce(sum(${allowanceTransactions.cents}), 0)`
		})
		.from(members)
		.leftJoin(allowanceTransactions, eq(allowanceTransactions.memberId, members.id))
		.groupBy(members.id)
		.all();
	return Object.fromEntries(rows.map((r) => [r.memberId, r.total]));
}

function requireMember(db: Reader, memberId: string) {
	const m = db.select().from(members).where(eq(members.id, memberId)).get();
	if (!m) throw new LedgerError('not_found', 'Member not found');
	return m;
}

export interface CashoutResult {
	entry: AllowanceEntry;
	starBalance: number;
	balanceCents: number;
}

/** Converts `stars` of the member's stars into money at the current rate. */
export function cashOut(
	db: Db,
	input: { memberId: string; stars: unknown; now?: number }
): CashoutResult {
	const now = input.now ?? Date.now();
	return db.transaction((tx) => {
		requireMember(tx, input.memberId);
		const before = starBalance(tx as unknown as Db, input.memberId);
		const plan = planCashout(input.stars, before, getRate(tx as unknown as Db));
		if (!plan.ok) throw new LedgerError('invalid', plan.error);
		const starTx = tx
			.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId: input.memberId,
				delta: -plan.stars,
				reason: 'cashout',
				note: 'Cashed out for allowance',
				status: 'approved',
				createdAt: now
			})
			.returning()
			.get();
		const entry = tx
			.insert(allowanceTransactions)
			.values({
				id: randomUUID(),
				memberId: input.memberId,
				cents: plan.cents,
				kind: 'cashout',
				stars: plan.stars,
				refId: starTx.id,
				createdAt: now
			})
			.returning()
			.get();
		return {
			entry,
			starBalance: before - plan.stars,
			balanceCents: allowanceBalance(tx, input.memberId)
		};
	});
}

/** Records money handed over: a debit of `cents`, never more than the balance. */
export function recordPayout(
	db: Db,
	input: { memberId: string; cents: unknown; note?: string; now?: number }
): { entry: AllowanceEntry; balanceCents: number } {
	return db.transaction((tx) => {
		requireMember(tx, input.memberId);
		const plan = planPayout(input.cents, allowanceBalance(tx, input.memberId));
		if (!plan.ok) throw new LedgerError('invalid', plan.error);
		const entry = tx
			.insert(allowanceTransactions)
			.values({
				id: randomUUID(),
				memberId: input.memberId,
				cents: -plan.cents,
				kind: 'payout',
				note: input.note?.trim().slice(0, 200) || null,
				...(input.now === undefined ? {} : { createdAt: input.now })
			})
			.returning()
			.get();
		return { entry, balanceCents: allowanceBalance(tx, input.memberId) };
	});
}

/** A signed manual correction with a required note; the balance may not go below zero. */
export function adjustAllowance(
	db: Db,
	input: { memberId: string; cents: unknown; note: unknown; now?: number }
): { entry: AllowanceEntry; balanceCents: number } {
	return db.transaction((tx) => {
		requireMember(tx, input.memberId);
		const plan = planAdjustment(input.cents, input.note);
		if (!plan.ok) throw new LedgerError('invalid', plan.error);
		if (allowanceBalance(tx, input.memberId) + plan.cents < 0)
			throw new LedgerError('conflict', 'That would take the balance below zero.');
		const entry = tx
			.insert(allowanceTransactions)
			.values({
				id: randomUUID(),
				memberId: input.memberId,
				cents: plan.cents,
				kind: 'adjustment',
				note: plan.note,
				...(input.now === undefined ? {} : { createdAt: input.now })
			})
			.returning()
			.get();
		return { entry, balanceCents: allowanceBalance(tx, input.memberId) };
	});
}

/** Ledger entries newest first, optionally for one member. */
export function allowanceHistory(
	db: Db,
	opts: { memberId?: string; limit?: number } = {}
): AllowanceEntry[] {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	return db
		.select()
		.from(allowanceTransactions)
		.where(
			opts.memberId === undefined ? undefined : eq(allowanceTransactions.memberId, opts.memberId)
		)
		.orderBy(desc(allowanceTransactions.createdAt), desc(allowanceTransactions.id))
		.limit(limit)
		.all();
}
