/**
 * The reward shop (REW-5) and small-versus-big rewards (REW-6). Pure helpers: the balance is
 * computed from the ledger on the server and passed in; nothing here stores it.
 *
 * "Small" is derived, not stored: a reward is small when its cost is at most the threshold.
 * That needs no schema change, and a grown-up changing a cost reclassifies it automatically.
 */

/** Rewards costing this many stars or fewer count as small. */
export const SMALL_REWARD_MAX = 10;

export interface ShopReward {
	id: string;
	title: string;
	image: string | null;
	cost: number;
}

export type RewardSize = 'small' | 'big';

export function rewardSize(cost: number, threshold = SMALL_REWARD_MAX): RewardSize {
	return cost <= threshold ? 'small' : 'big';
}

export interface ShopCard {
	size: RewardSize;
	affordable: boolean;
	isGoal: boolean;
	stillNeed: number;
	/** "You have enough!" or "5 more stars". */
	label: string;
	/** Small rewards that can be afforded right now (and are not already the goal's job). */
	canGetNow: boolean;
	/** Big rewards, and the current goal, are chosen rather than bought here. */
	canMakeGoal: boolean;
}

export function shopCard(
	reward: ShopReward,
	balance: number,
	goalId: string | null,
	threshold = SMALL_REWARD_MAX
): ShopCard {
	const b = Math.max(0, Math.floor(balance));
	const affordable = b >= reward.cost;
	const stillNeed = affordable ? 0 : reward.cost - b;
	const size = rewardSize(reward.cost, threshold);
	const isGoal = reward.id === goalId;
	return {
		size,
		affordable,
		isGoal,
		stillNeed,
		label: affordable
			? 'You have enough!'
			: `${stillNeed} more ${stillNeed === 1 ? 'star' : 'stars'}`,
		canGetNow: size === 'small' && affordable,
		canMakeGoal: !isGoal
	};
}

export interface GoalEffect {
	/** Stars left after the purchase. */
	after: number;
	/** Goal progress before and after, as "balance/cost". */
	from: string;
	to: string;
	/** The sentence shown before confirming. */
	text: string;
}

/**
 * What spending on `reward` does to the big goal. Null when there is no goal, or the reward is
 * the goal itself (nothing to compare: it simply gets bought).
 */
export function goalEffect(
	balance: number,
	reward: ShopReward,
	goal: { id: string; title: string; cost: number } | null
): GoalEffect | null {
	if (!goal || goal.id === reward.id) return null;
	const b = Math.max(0, Math.floor(balance));
	const after = Math.max(0, b - reward.cost);
	const from = `${b}/${goal.cost}`;
	const to = `${after}/${goal.cost}`;
	return { after, from, to, text: `Your ${goal.title} goal goes from ${from} to ${to}` };
}
