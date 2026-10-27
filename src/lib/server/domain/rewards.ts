/**
 * Reward definitions and per-member goals (requirements REW-1; §3.5, §7).
 *
 * Rules:
 * - Rewards are archived (`active = false`), never hard-deleted, so redemption
 *   history keeps its reference. There is deliberately no delete function.
 * - A member keeps several goals (hub-ar4.3) but exactly one is current (the jar's). The
 *   schema has no unique constraint, so {@link setGoal} and friends flip the flag in a transaction.
 * - A kid-named goal is a reward with an `ownerId`: it stays out of the shared catalog and is
 *   redeemed through the same PIN-protected flow as any reward.
 * - Progress uses the approved-only balance; pending stars never count.
 * - Redemption itself is a separate concern (hub-6tv.3).
 */
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isSingleEmoji } from '#lib/domain/emoji.js';
import type { Db } from '../db/index.js';
import { goals, members, rewards } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { starBalance } from './stars.js';

export type Reward = typeof rewards.$inferSelect;

export const TITLE_MAX = 60;
export const COST_MIN = 1;
export const COST_MAX = 10_000;
/** Goals one member may keep at a time (own goals only; catalog picks are not capped). */
export const OWN_GOALS_MAX = 12;

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
	if (!isSingleEmoji(v)) throw invalid('image must be a single emoji');
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

/**
 * Active catalog rewards by default, cheapest first; `includeArchived` adds the rest.
 * Kid-named goals are never in the catalog; `forMemberId` adds that member's own.
 */
export function listRewards(
	db: Db,
	opts: { includeArchived?: boolean; forMemberId?: string } = {}
): Reward[] {
	const mine = opts.forMemberId
		? or(isNull(rewards.ownerId), eq(rewards.ownerId, opts.forMemberId))
		: isNull(rewards.ownerId);
	const all = db
		.select()
		.from(rewards)
		.where(mine)
		.orderBy(asc(rewards.cost), asc(rewards.title))
		.all();
	return opts.includeArchived ? all : all.filter((r) => r.active);
}

/** Insertion order: goal ids are random UUIDs, so the rowid is the only age. */
const newestFirst = sql.raw('"goals".rowid');

type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

/** Adds the goal row if missing and makes it the member's only current one. */
function makeCurrent(tx: Tx, memberId: string, rewardId: string): void {
	tx.update(goals).set({ current: false }).where(eq(goals.memberId, memberId)).run();
	const row = tx
		.select()
		.from(goals)
		.where(and(eq(goals.memberId, memberId), eq(goals.rewardId, rewardId)))
		.get();
	if (row) tx.update(goals).set({ current: true }).where(eq(goals.id, row.id)).run();
	else tx.insert(goals).values({ id: randomUUID(), memberId, rewardId, current: true }).run();
}

function progressFor(balance: number, reward: Reward) {
	const cost = reward.cost;
	return {
		balance,
		cost,
		remaining: Math.max(0, cost - balance),
		percent: Math.min(100, Math.max(0, Math.floor((balance / cost) * 100)))
	};
}

/**
 * Makes `rewardId` the member's current goal. Other goals are kept, just not current. A reward
 * owned by another member cannot be picked.
 */
export function setGoal(db: Db, memberId: string, rewardId: string): GoalProgress {
	db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, memberId)).get())
			throw new LedgerError('not_found', 'Member not found');
		const reward = tx.select().from(rewards).where(eq(rewards.id, rewardId)).get();
		if (!reward || !reward.active || (reward.ownerId && reward.ownerId !== memberId))
			throw new LedgerError('not_found', 'Reward not found');
		makeCurrent(tx, memberId, rewardId);
	});
	return getGoal(db, memberId)!;
}

/** The member's current goal with progress, or null when none is set. */
export function getGoal(db: Db, memberId: string): GoalProgress | null {
	const row = db
		.select({ reward: rewards })
		.from(goals)
		.innerJoin(rewards, eq(goals.rewardId, rewards.id))
		.where(and(eq(goals.memberId, memberId), eq(goals.current, true)))
		.get();
	if (!row || !row.reward.active) return null;
	return { reward: row.reward, ...progressFor(starBalance(db, memberId), row.reward) };
}

export interface GoalListEntry extends GoalProgress {
	current: boolean;
	/** True for a kid-named goal (removable by the kid); false for a catalog pick. */
	own: boolean;
}

/** Every active goal the member keeps, current first, then newest. */
export function listGoals(db: Db, memberId: string): GoalListEntry[] {
	const balance = starBalance(db, memberId);
	return db
		.select({ reward: rewards, current: goals.current })
		.from(goals)
		.innerJoin(rewards, eq(goals.rewardId, rewards.id))
		.where(and(eq(goals.memberId, memberId), eq(rewards.active, true)))
		.orderBy(desc(goals.current), desc(newestFirst))
		.all()
		.map((r) => ({
			reward: r.reward,
			current: r.current,
			own: r.reward.ownerId === memberId,
			...progressFor(balance, r.reward)
		}));
}

/** A kid names their own goal (title, emoji, cost) and it becomes current. No approval. */
export function createOwnGoal(db: Db, memberId: string, input: RewardInput): GoalProgress {
	const title = validTitle(input.title);
	const cost = validCost(input.cost);
	const image = validImage(input.image);
	const reward = db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, memberId)).get())
			throw new LedgerError('not_found', 'Member not found');
		const own = tx
			.select()
			.from(rewards)
			.where(and(eq(rewards.ownerId, memberId), eq(rewards.active, true)))
			.all();
		if (own.length >= OWN_GOALS_MAX)
			throw new LedgerError('conflict', `Only ${OWN_GOALS_MAX} goals at a time. Remove one first!`);
		const created = tx
			.insert(rewards)
			.values({ id: randomUUID(), title, cost, image, ownerId: memberId })
			.returning()
			.get();
		makeCurrent(tx, memberId, created.id);
		return created;
	});
	return { reward, ...progressFor(starBalance(db, memberId), reward) };
}

/**
 * Drops a goal from the member's list. A kid-named goal is archived (redemption history keeps
 * its reference). If it was current, the newest remaining goal takes over.
 */
export function removeGoal(db: Db, memberId: string, rewardId: string): void {
	db.transaction((tx) => {
		const row = tx
			.select({ id: goals.id, current: goals.current, ownerId: rewards.ownerId })
			.from(goals)
			.innerJoin(rewards, eq(goals.rewardId, rewards.id))
			.where(and(eq(goals.memberId, memberId), eq(goals.rewardId, rewardId)))
			.get();
		if (!row) throw new LedgerError('not_found', 'Goal not found');
		tx.delete(goals).where(eq(goals.id, row.id)).run();
		if (row.ownerId === memberId)
			tx.update(rewards).set({ active: false }).where(eq(rewards.id, rewardId)).run();
		if (!row.current) return;
		const next = tx
			.select({ rewardId: goals.rewardId })
			.from(goals)
			.innerJoin(rewards, eq(goals.rewardId, rewards.id))
			.where(and(eq(goals.memberId, memberId), eq(rewards.active, true)))
			.orderBy(desc(newestFirst))
			.get();
		if (next) makeCurrent(tx, memberId, next.rewardId);
	});
}

/**
 * Whether a child may pick this reward as their own goal without a grown-up (REW-5).
 * Narrow on purpose: an existing child-role member and an existing, active reward. Picking a goal
 * moves no stars; spending them still needs the adult PIN.
 */
export function kidMayPickGoal(db: Db, memberId: string, rewardId: string): boolean {
	const member = db.select().from(members).where(eq(members.id, memberId)).get();
	if (!member || member.role !== 'child') return false;
	const reward = db.select().from(rewards).where(eq(rewards.id, rewardId)).get();
	return !!reward && reward.active && (!reward.ownerId || reward.ownerId === memberId);
}

/** Whether this member may manage their own goals without a grown-up: an existing child. */
export function isKidSelfServe(db: Db, memberId: string): boolean {
	return db.select().from(members).where(eq(members.id, memberId)).get()?.role === 'child';
}
