/**
 * Ad hoc bonus stars and deductions (requirement CHO-11). Pure rules shared by the grown-up
 * screen and the API.
 *
 * Deduction rule: a removal is clamped to the child's balance. The balance never goes below
 * zero, so taking 5 from a child holding 3 removes 3 (and says so). A child holding 0 has
 * nothing to remove and the request is refused.
 */

export const GIVE_AMOUNTS = [1, 2, 5] as const;
export const REMOVE_AMOUNTS = [1, 2] as const;
export const QUICK_REASONS = ['Great job sharing!', 'Extra help', 'Kindness'] as const;
export const MAX_AMOUNT = 50;
export const MAX_NOTE = 200;

export type AdjustmentResult =
	{ ok: true; delta: number; note: string; clamped: boolean } | { ok: false; error: string };

/**
 * Validates a signed adjustment against the current balance.
 * Giving: a note is optional (defaults to "Bonus stars"). Removing: a note is required.
 */
export function planAdjustment(input: {
	delta: unknown;
	note?: unknown;
	balance: number;
}): AdjustmentResult {
	const { delta } = input;
	if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0)
		return { ok: false, error: 'Pick a whole number of stars.' };
	if (Math.abs(delta) > MAX_AMOUNT) return { ok: false, error: `At most ${MAX_AMOUNT} at a time.` };
	const note = typeof input.note === 'string' ? input.note.trim() : '';
	if (note.length > MAX_NOTE)
		return { ok: false, error: `Keep the note under ${MAX_NOTE} letters.` };
	if (delta > 0) return { ok: true, delta, note: note || 'Bonus stars', clamped: false };
	if (!note) return { ok: false, error: 'Add a note so everyone knows why.' };
	const balance = Math.max(0, input.balance);
	if (balance === 0) return { ok: false, error: 'There are no stars to remove.' };
	const taken = Math.min(-delta, balance);
	return { ok: true, delta: -taken, note, clamped: taken < -delta };
}

/** "Give 2 ⭐" / "Remove 1 ⭐" for the action button. */
export function actionLabel(delta: number): string {
	if (delta === 0) return 'Pick an amount';
	return `${delta > 0 ? 'Give' : 'Remove'} ${Math.abs(delta)} ⭐`;
}

export interface LedgerRow {
	id: string;
	delta: number;
	reason: string;
	note: string | null;
	status: string;
	createdAt: number;
}

const ACTIVITY_REASONS = new Set(['bonus', 'adjustment', 'streak']);

/** Approved bonus, adjustment and streak rows, newest first, capped. */
export function activityRows(history: LedgerRow[], limit = 10): LedgerRow[] {
	return history
		.filter((r) => ACTIVITY_REASONS.has(r.reason) && r.status === 'approved')
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, limit);
}

export function activityTitle(row: LedgerRow): string {
	if (row.reason === 'streak') return row.note ?? 'Streak bonus';
	return row.note ?? (row.delta > 0 ? 'Bonus stars' : 'Stars removed');
}

/**
 * Bonus rows a child has not seen yet. `seenAt` is the newest createdAt already shown (null on
 * the first look, which never celebrates so a reload does not replay old gifts).
 */
export function newBonuses(history: LedgerRow[], seenAt: number | null): LedgerRow[] {
	if (seenAt === null) return [];
	return history.filter(
		(r) => r.reason === 'bonus' && r.status === 'approved' && r.createdAt > seenAt
	);
}

/** Newest createdAt across every row, the marker `newBonuses` compares to. */
export function newestAt(history: LedgerRow[]): number {
	return history.reduce((max, r) => Math.max(max, r.createdAt), 0);
}
