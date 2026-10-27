/**
 * Reading and practice star math (hub-kko.1). Pure functions, no I/O.
 *
 * The rule, in kid words: "Every 15 minutes you log today is a star (up to the daily limit)."
 * Leftover minutes carry over within the same day, so 10 minutes then 5 more earns the star.
 * The day's stars are worked out from the day's TOTAL minutes, never per log, so splitting a
 * session into many small logs earns exactly what one big log would. A new day starts at zero.
 */
export interface PracticeRate {
	/** Minutes that make one block. */
	minutesPerBlock: number;
	/** Stars each full block earns. */
	starsPerBlock: number;
	/** Most stars this activity can earn in one day. */
	dailyStarCap: number;
}

/** Longest single log a kid can enter, and the most minutes one day can hold. */
export const MAX_LOG_MINUTES = 600;

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Stars a day's total minutes are worth under `rate`, after the daily cap. */
export function starsForMinutes(rate: PracticeRate, totalMinutes: number): number {
	const block = whole(rate.minutesPerBlock);
	if (block < 1) return 0;
	const raw = Math.floor(whole(totalMinutes) / block) * whole(rate.starsPerBlock);
	return Math.min(raw, whole(rate.dailyStarCap));
}

/** New stars for logging `newMinutes` when `minutesToday` were already logged today. */
export function starsForLog(rate: PracticeRate, minutesToday: number, newMinutes: number): number {
	const add = whole(newMinutes);
	if (add === 0) return 0;
	const before = whole(minutesToday);
	return starsForMinutes(rate, before + add) - starsForMinutes(rate, before);
}

/** Minutes left until the next star, or null once the daily cap is reached. */
export function minutesToNextStar(rate: PracticeRate, minutesToday: number): number | null {
	const block = whole(rate.minutesPerBlock);
	if (block < 1) return null;
	const total = whole(minutesToday);
	if (starsForMinutes(rate, total) >= whole(rate.dailyStarCap)) return null;
	return block - (total % block);
}

/** The kid-facing line under the log button: how far the next star is, or that today is full. */
export function nextStarLine(minutesLeft: number | null): string {
	if (minutesLeft === null) return 'All stars earned today!';
	return `${minutesLeft} more ${minutesLeft === 1 ? 'minute' : 'minutes'} to your next star`;
}

/** The +5 / -5 adjuster: whole 5s, never below 5 or above the UI limit. */
export const STEP_MIN = 5;
export const STEP_MAX = 240;
export function stepMinutes(current: number, direction: 1 | -1): number {
	const next = (Math.round(whole(current) / STEP_MIN) + direction) * STEP_MIN;
	return Math.min(STEP_MAX, Math.max(STEP_MIN, next));
}
