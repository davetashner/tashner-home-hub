/**
 * Collectible badges and stickers (requirement CHO-14). Pure: no clock, storage or database.
 *
 * Badges are derived from the ledger and history every time, so they never drift from the stars.
 * The only stored thing is which badges a screen has already celebrated (see {@link badgeDecision}).
 */

/** Everything the catalog is judged from. The server builds this from the ledger and history. */
export interface BadgeFacts {
	/** Approved Star Job completions, ever. */
	starJobsDone: number;
	/** Stars earned, ever: approved gains only, never net of spending or deductions. */
	lifetimeStars: number;
	/** Longest habit streak the child has ever had. */
	longestStreak: number;
	/** Rewards redeemed, ever. */
	redemptions: number;
	/** Most habits finished in a single Monday-to-Sunday week. */
	bestHabitWeek: number;
}

export interface BadgeDef {
	id: string;
	emoji: string;
	title: string;
	description: string;
	/** Shown on the greyed silhouette. */
	hint: string;
	earned: (facts: BadgeFacts) => boolean;
}

const stars = (id: string, emoji: string, n: number): BadgeDef => ({
	id,
	emoji,
	title: `${n} stars`,
	description: `You have earned ${n} stars in all.`,
	hint: `Earn ${n} stars in all`,
	earned: (f) => f.lifetimeStars >= n
});

const streak = (id: string, emoji: string, n: number): BadgeDef => ({
	id,
	emoji,
	title: `${n}-day streak`,
	description: `You did your habits ${n} days in a row.`,
	hint: `Do your habits ${n} days in a row`,
	earned: (f) => f.longestStreak >= n
});

export const BADGES: readonly BadgeDef[] = [
	{
		id: 'first-star-job',
		emoji: '🌟',
		title: 'First Star Job',
		description: 'You finished your very first Star Job.',
		hint: 'Finish a Star Job',
		earned: (f) => f.starJobsDone >= 1
	},
	stars('stars-10', '🥉', 10),
	stars('stars-50', '🥈', 50),
	stars('stars-100', '🥇', 100),
	stars('stars-500', '👑', 500),
	streak('streak-3', '🌱', 3),
	streak('streak-7', '🔥', 7),
	streak('streak-30', '🚀', 30),
	{
		id: 'first-reward',
		emoji: '🎁',
		title: 'First reward',
		description: 'You traded your stars for a reward.',
		hint: 'Get a reward from the shop',
		earned: (f) => f.redemptions >= 1
	},
	{
		id: 'habit-week',
		emoji: '🦸',
		title: 'Habit hero',
		description: 'You did 7 habits in one week.',
		hint: 'Do 7 habits in one week',
		earned: (f) => f.bestHabitWeek >= 7
	}
];

export interface Sticker {
	id: string;
	emoji: string;
	title: string;
	description: string;
	hint: string;
	earned: boolean;
}

/** The whole sticker book, in catalog order. */
export function stickerBook(facts: BadgeFacts): Sticker[] {
	return BADGES.map(({ earned, ...b }) => ({ ...b, earned: earned(facts) }));
}

export const earnedIds = (book: readonly Sticker[]): string[] =>
	book.filter((s) => s.earned).map((s) => s.id);

/** Monday (YYYY-MM-DD) of the week holding `date`. */
export function weekStart(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** Most dates (one per finished habit) that fall in a single Monday-to-Sunday week. */
export function bestWeekCount(dates: readonly string[]): number {
	const perWeek = new Map<string, number>();
	for (const date of dates) perWeek.set(weekStart(date), (perWeek.get(weekStart(date)) ?? 0) + 1);
	return Math.max(0, ...perWeek.values());
}

/**
 * Longest run of `complete` days in chronological order. A `missed` day ends the run; a `none`
 * day is skipped, as in a live streak.
 */
export function longestRun(outcomes: readonly ('complete' | 'missed' | 'none')[]): number {
	let best = 0;
	let run = 0;
	for (const o of outcomes) {
		if (o === 'complete') best = Math.max(best, (run += 1));
		else if (o === 'missed') run = 0;
	}
	return best;
}

/** Streak length proven by a paid `streak:<days>:<runStart>` ledger ref (survives old history). */
export function paidStreakDays(refs: readonly (string | null)[]): number {
	return Math.max(0, ...refs.map((r) => Number(/^streak:(\d+):/.exec(r ?? '')?.[1] ?? 0)));
}

/** localStorage key remembering which badges one child's screen has already celebrated. */
export const badgesSeenKey = (memberId: string) => `hub.badges-seen.${memberId}`;

export interface BadgeDecision {
	/** Badge ids to celebrate now. */
	celebrate: string[];
	/** The value to store (JSON array of earned ids). */
	store: string;
}

/**
 * Decides which earned badges are new on this screen. With nothing stored yet (a first visit, or a
 * kid whose badges were earned before this feature) it seeds silently; after that every badge not
 * yet in the stored list is celebrated exactly once.
 */
export function badgeDecision(stored: string | null, earned: readonly string[]): BadgeDecision {
	let seen: string[] | null = null;
	try {
		const parsed: unknown = stored === null ? null : JSON.parse(stored);
		if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		// corrupt value: treat as a first visit
	}
	const known = new Set(seen ?? []);
	return {
		celebrate: seen === null ? [] : earned.filter((id) => !known.has(id)),
		store: JSON.stringify([...new Set([...known, ...earned])])
	};
}
