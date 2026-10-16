/**
 * Reward definitions and per-member goals (requirements REW-1; §3.5, §7).
 *
 * Rules:
 * - Rewards are archived (`active = false`), never hard-deleted, so redemption
 *   history keeps its reference. There is deliberately no delete function.
 * - A member has at most one current goal. The schema has no unique constraint
 *   (frozen), so {@link setGoal} enforces it by replacing the row in a transaction.
 * - Progress uses the approved-only balance; pending stars never count.
 * - Redemption itself is a separate concern (hub-6tv.3).
 */
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { goals, members, rewards } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { starBalance } from './stars.js';

export type Reward = typeof rewards.$inferSelect;

export const TITLE_MAX = 60;
export const COST_MIN = 1;
export const COST_MAX = 10_000;

export interface RewardInput {
	title: string;
	cost: number;
	/** A single emoji, or null for none (photo uploads come later). */
	image?: string | null;
}

export interface GoalProgress {
	reward: Reward;
	balance: number;
	cost: number;
	remaining: number;
	/** 0-100, whole number, capped at 100. */
	percent: number;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function validTitle(v: unknown): string {
	const t = typeof v === 'string' ? v.trim() : '';
	if (t.length < 1 || t.length > TITLE_MAX)
		throw invalid(`title must be 1-${TITLE_MAX} characters`);
	return t;
}

function validCost(v: unknown): number {
	if (!Number.isInteger(v) || (v as number) < COST_MIN || (v as number) > COST_MAX)
		throw invalid(`cost must be a whole number from ${COST_MIN} to ${COST_MAX}`);
	return v as number;
}

function validImage(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	const ok =
		typeof v === 'string' &&
		[...segmenter.segment(v)].length === 1 &&
		/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(v);
	if (!ok) throw invalid('image must be a single emoji');
	return v;
}

export function createReward(db: Db, input: RewardInput): Reward {
	return db
		.insert(rewards)
		.values({
			id: randomUUID(),
			title: validTitle(input.title),
			cost: validCost(input.cost),
			image: validImage(input.image)
		})
		.returning()
		.get();
}

/** Updates only the fields present in `patch`. */
export function updateReward(db: Db, id: string, patch: Partial<RewardInput>): Reward {
	const set: Partial<typeof rewards.$inferInsert> = {};
	if (patch.title !== undefined) set.title = validTitle(patch.title);
	if (patch.cost !== undefined) set.cost = validCost(patch.cost);
	if (patch.image !== undefined) set.image = validImage(patch.image);
	return db.transaction((tx) => {
		const existing = tx.select().from(rewards).where(eq(rewards.id, id)).get();
		if (!existing) throw new LedgerError('not_found', 'Reward not found');
		if (Object.keys(set).length === 0) return existing;
		return tx.update(rewards).set(set).where(eq(rewards.id, id)).returning().get();
	});
}

/** Soft-removes a reward and clears any goals pointing at it. Idempotent. */
export function archiveReward(db: Db, id: string): Reward {
	return db.transaction((tx) => {
		const updated = tx
			.update(rewards)
			.set({ active: false })
			.where(eq(rewards.id, id))
			.returning()
			.get();
		if (!updated) throw new LedgerError('not_found', 'Reward not found');
		tx.delete(goals).where(eq(goals.rewardId, id)).run();
		return updated;
	});
}

/** Active rewards by default, cheapest first; `includeArchived` adds the rest. */
export function listRewards(db: Db, opts: { includeArchived?: boolean } = {}): Reward[] {
	const all = db.select().from(rewards).orderBy(asc(rewards.cost), asc(rewards.title)).all();
	return opts.includeArchived ? all : all.filter((r) => r.active);
}

/** Makes `rewardId` the member's one current goal, replacing any existing goal. */
export function setGoal(db: Db, memberId: string, rewardId: string): GoalProgress {
	db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, memberId)).get())
			throw new LedgerError('not_found', 'Member not found');
		const reward = tx.select().from(rewards).where(eq(rewards.id, rewardId)).get();
		if (!reward || !reward.active) throw new LedgerError('not_found', 'Reward not found');
		tx.delete(goals).where(eq(goals.memberId, memberId)).run();
		tx.insert(goals).values({ id: randomUUID(), memberId, rewardId }).run();
	});
	return getGoal(db, memberId)!;
}

/** The member's current goal with progress, or null when none is set. */
export function getGoal(db: Db, memberId: string): GoalProgress | null {
	const row = db
		.select({ reward: rewards })
		.from(goals)
		.innerJoin(rewards, eq(goals.rewardId, rewards.id))
		.where(eq(goals.memberId, memberId))
		.get();
	if (!row || !row.reward.active) return null;
	const balance = starBalance(db, memberId);
	const cost = row.reward.cost;
	return {
		reward: row.reward,
		balance,
		cost,
		remaining: Math.max(0, cost - balance),
		percent: Math.min(100, Math.max(0, Math.floor((balance / cost) * 100)))
	};
}
