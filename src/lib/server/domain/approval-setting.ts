/**
 * Whether kids' to-dos need a grown-up's OK (hub-526). The household default is OFF: a kid
 * completes a to-do and the stars land at once. Each chore still carries its own
 * `requiresApproval`; this setting only decides what a new chore starts with.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, settings } from '../db/schema.js';
import { approveCompletion } from './ledger.js';

export const APPROVAL_SETTING_KEY = 'chores.approval';

/** True when new to-dos should need a grown-up's OK. Missing or corrupt reads as off. */
export function approvalDefault(db: Db): boolean {
	const row = db.select().from(settings).where(eq(settings.key, APPROVAL_SETTING_KEY)).get();
	if (!row) return false;
	try {
		return JSON.parse(row.value) === true;
	} catch {
		return false;
	}
}

export function setApprovalDefault(db: Db, on: boolean): boolean {
	const value = JSON.stringify(on);
	db.insert(settings)
		.values({ key: APPROVAL_SETTING_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return on;
}

export interface ApprovalsOff {
	/** Chores that needed approval and no longer do. */
	chores: number;
	/** Completions that were waiting and are now approved (their stars counted). */
	approved: number;
}

/**
 * Turns approval off everywhere: the household default, every chore, and every completion
 * still waiting (approved through the ledger so the stars land exactly as a grown-up's OK would).
 */
export function turnOffAllApprovals(db: Db): ApprovalsOff {
	return db.transaction((tx) => {
		setApprovalDefault(tx as unknown as Db, false);
		const changed = tx
			.update(chores)
			.set({ requiresApproval: false })
			.where(eq(chores.requiresApproval, true))
			.returning({ id: chores.id })
			.all();
		const waiting = tx
			.select({ id: choreCompletions.id })
			.from(choreCompletions)
			.where(eq(choreCompletions.status, 'pending'))
			.all();
		for (const w of waiting) approveCompletion(tx as unknown as Db, w.id);
		return { chores: changed.length, approved: waiting.length };
	});
}
