/** Money savings goals (hub-ar4): input validation and progress math. Plain TypeScript, no I/O. */
import { MAX_ENTRY_CENTS, formatMoney } from './allowance.js';

export const GOAL_TITLE_MAX = 40;
export const GOAL_MIN_CENTS = 100;
export const GOAL_MAX_CENTS = MAX_ENTRY_CENTS;

export interface GoalFields {
	title: string;
	emoji: string | null;
	targetCents: number;
}

export type GoalParse = { ok: true; value: Partial<GoalFields> } | { ok: false; error: string };

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Validates a create (`partial` false: title and targetCents required) or an edit (`partial`
 * true: only the fields present are checked). Unknown fields are ignored.
 */
export function parseGoalInput(input: unknown, partial: boolean): GoalParse {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		return { ok: false, error: 'Expected an object.' };
	const raw = input as Record<string, unknown>;
	const value: Partial<GoalFields> = {};

	if (raw.title !== undefined || !partial) {
		const t = typeof raw.title === 'string' ? raw.title.trim() : '';
		if (t.length < 1 || t.length > GOAL_TITLE_MAX)
			return { ok: false, error: `Name the goal in 1-${GOAL_TITLE_MAX} letters.` };
		value.title = t;
	}
	if (raw.emoji !== undefined) {
		const e = raw.emoji;
		if (e === null || e === '') value.emoji = null;
		else if (
			typeof e === 'string' &&
			[...segmenter.segment(e)].length === 1 &&
			/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(e)
		)
			value.emoji = e;
		else return { ok: false, error: 'Pick a single emoji.' };
	}
	if (raw.targetCents !== undefined || !partial) {
		const c = raw.targetCents;
		if (typeof c !== 'number' || !Number.isInteger(c) || c < GOAL_MIN_CENTS || c > GOAL_MAX_CENTS)
			return { ok: false, error: 'The price must be a whole number of cents, $1 to $10,000.' };
		value.targetCents = c;
	}
	return { ok: true, value };
}

/** Saved so far: the balance, capped at the price, never negative. */
export function goalProgress(balanceCents: number, targetCents: number) {
	const savedCents = Math.max(0, Math.min(balanceCents, targetCents));
	return { savedCents, targetCents, reached: savedCents >= targetCents };
}

/** The price stepper works in whole dollars; the price is stored in cents. */
export const GOAL_DEFAULT_CENTS = 2000;

/** Moves a price by whole dollars (negative steps down), kept inside the allowed range. */
export function bumpGoalCents(cents: number, dollars: number): number {
	const next = Math.round(cents) + Math.trunc(dollars) * 100;
	return Math.min(GOAL_MAX_CENTS, Math.max(GOAL_MIN_CENTS, next));
}

/** "$12.50 of $40.00" (cents are integers; the symbol is the household's). */
export function goalCaption(savedCents: number, targetCents: number, symbol = '$'): string {
	return `${formatMoney(savedCents, symbol)} of ${formatMoney(targetCents, symbol)}`;
}

/** Whole-number percent saved, 0-100, for the jar's fill. */
export function goalPercent(savedCents: number, targetCents: number): number {
	if (!(targetCents > 0)) return 0;
	return Math.min(100, Math.max(0, Math.floor((savedCents / targetCents) * 100)));
}

/** localStorage key remembering which money goal's party was already thrown. */
export const moneyReachedKey = (goalId: string) => `hub.money-goal-reached.${goalId}`;
