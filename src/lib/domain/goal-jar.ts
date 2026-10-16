/**
 * The kid's goal jar (REW-2) and the once-per-reaching "You earned it!" party (REW-3).
 * The balance comes from the server, which computes it from the ledger; nothing here stores it.
 */

export interface JarFill {
	/** 0-1: approved stars toward the cost (the gold layer). */
	gold: number;
	/** 0-1: approved plus waiting stars (the pale layer behind the gold). */
	pending: number;
	/** Whole-number percent of the cost earned, capped at 100. */
	percent: number;
	remaining: number;
	reached: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function jarFill(balance: number, pending: number, cost: number): JarFill {
	const b = Math.max(0, Math.floor(balance));
	const p = Math.max(0, Math.floor(pending));
	if (!(cost > 0)) return { gold: 0, pending: 0, percent: 0, remaining: 0, reached: false };
	return {
		gold: clamp01(b / cost),
		pending: clamp01((b + p) / cost),
		percent: Math.min(100, Math.floor((b / cost) * 100)),
		remaining: Math.max(0, cost - b),
		reached: b >= cost
	};
}

/** "42 of 100 stars" (the requirement's wording); the balance is shown even past the cost. */
export function jarCaption(balance: number, cost: number): string {
	const b = Math.max(0, Math.floor(balance));
	return `${b} of ${cost} ${cost === 1 ? 'star' : 'stars'}`;
}

/** localStorage key remembering which goal a child's party was already thrown for. */
export const earnedKey = (memberId: string) => `hub.goal-earned.${memberId}`;

export interface GoalState {
	rewardId: string;
	cost: number;
	balance: number;
}

export interface EarnedDecision {
	celebrate: boolean;
	/** What to remember next: a marker string, or null to forget (re-arms the party). */
	store: string | null;
}

/**
 * Decide whether to throw the "You earned it!" party.
 * Once per reaching: the marker names the reward and its cost, so a new goal (or a new cost)
 * celebrates again, and dropping below the cost (a redemption) re-arms it.
 */
export function earnedDecision(stored: string | null, goal: GoalState | null): EarnedDecision {
	if (!goal || goal.balance < goal.cost) return { celebrate: false, store: null };
	const marker = `${goal.rewardId}:${goal.cost}`;
	return { celebrate: stored !== marker, store: marker };
}
