/**
 * Habit streaks (requirement CHO-10). Pure: no clock, storage or database access.
 *
 * Rules:
 * - A day is judged in the household time zone (callers pass YYYY-MM-DD strings).
 * - Only habits count; Star Jobs never affect a streak (callers pass habit counts).
 * - A day is `complete` when the child had at least one habit due and every one of them has an
 *   approved completion. A day is `missed` when something was due and not all of it is approved.
 *   A day with no habit due is `none`: it is skipped, neither extending nor breaking a streak.
 * - Today is never a miss: while the day is still open, an unfinished `today` is skipped, so the
 *   streak shows yesterday's run until today is finished and approved.
 * - The streak is the number of `complete` days in an unbroken run ending today (or the latest day
 *   with habits). A `missed` day ends the run.
 * - Each milestone pays out once per run, keyed by {@link streakRef}.
 */

export type DayOutcome = 'complete' | 'missed' | 'none';

export interface Milestone {
	days: number;
	stars: number;
}

export const DEFAULT_MILESTONES: readonly Milestone[] = [
	{ days: 3, stars: 2 },
	{ days: 7, stars: 5 },
	{ days: 14, stars: 10 },
	{ days: 30, stars: 25 }
];

/** Settings key holding the JSON milestone list. */
export const STREAK_SETTINGS_KEY = 'chores.streakMilestones';

/** How far back a streak is counted. */
export const MAX_STREAK_DAYS = 366;

export interface Streak {
	/** Complete days in the current run. */
	days: number;
	/** First counted day of the run (YYYY-MM-DD), or null when days is 0. */
	runStart: string | null;
}

export function addDays(date: string, delta: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

/** Judges one day from how many chores were due and how many of those are approved. */
export function dayOutcome(due: number, approved: number): DayOutcome {
	if (due <= 0) return 'none';
	return approved >= due ? 'complete' : 'missed';
}

export function computeStreak(
	outcomeOf: (date: string) => DayOutcome,
	today: string,
	maxDays: number = MAX_STREAK_DAYS
): Streak {
	let days = 0;
	let runStart: string | null = null;
	for (let i = 0; i < maxDays; i++) {
		const date = addDays(today, -i);
		const outcome = outcomeOf(date);
		if (outcome === 'complete') {
			days += 1;
			runStart = date;
		} else if (outcome === 'missed' && i > 0) {
			break;
		}
	}
	return { days, runStart };
}

/** Coerces untrusted settings JSON into a sorted, de-duplicated milestone list. */
export function parseMilestones(raw: unknown): Milestone[] {
	if (!Array.isArray(raw)) return [...DEFAULT_MILESTONES];
	const byDays = new Map<number, number>();
	for (const item of raw) {
		const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		const { days, stars } = o;
		if (
			typeof days === 'number' &&
			typeof stars === 'number' &&
			Number.isInteger(days) &&
			Number.isInteger(stars) &&
			days >= 2 &&
			days <= MAX_STREAK_DAYS &&
			stars >= 1 &&
			stars <= 100
		)
			byDays.set(days, stars);
	}
	// An empty list switches bonuses off; a list with no valid entry falls back to the defaults.
	if (byDays.size === 0) return raw.length === 0 ? [] : [...DEFAULT_MILESTONES];
	return [...byDays].map(([days, stars]) => ({ days, stars })).sort((a, b) => a.days - b.days);
}

/** Ledger ref id for a milestone paid in the run that began on `runStart`. */
export const streakRef = (days: number, runStart: string) => `streak:${days}:${runStart}`;

function parseRef(ref: string | null): { days: number; runStart: string } | null {
	const m = /^streak:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(ref ?? '');
	return m ? { days: Number(m[1]), runStart: m[2] } : null;
}

/**
 * Milestones reached by this streak that have not been paid yet. A payout recorded for the same
 * milestone with a run start on or after this run's start belongs to this run (the run only
 * began earlier because a day was approved late), so it is not paid again.
 */
export function milestonesToAward(
	streak: Streak,
	milestones: readonly Milestone[],
	paidRefs: readonly (string | null)[]
): Milestone[] {
	const runStart = streak.runStart;
	if (!runStart) return [];
	const paid = paidRefs.map(parseRef).filter((p) => p !== null);
	return milestones.filter(
		(m) => m.days <= streak.days && !paid.some((p) => p.days === m.days && p.runStart >= runStart)
	);
}

/** The next milestone above the current streak, or null past the last one. */
export function nextMilestone(days: number, milestones: readonly Milestone[]): Milestone | null {
	return milestones.find((m) => m.days > days) ?? null;
}

/** True when the streak just grew onto a milestone (used for the on-screen celebration). */
export function reachedMilestone(
	before: number | undefined,
	after: number,
	milestones: readonly Milestone[]
): Milestone | null {
	if (before === undefined || after <= before) return null;
	return milestones.find((m) => m.days === after) ?? null;
}
