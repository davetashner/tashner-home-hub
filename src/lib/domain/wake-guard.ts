/**
 * Wake guard (hub-xcr.7, SLP-3): the touch that wakes a sleeping display must only wake it.
 * The Pi agent grabs the touch device while the screen is off, and this is the second layer: the
 * page swallows pointer and click events
 * - while the display reports `off` (the tap that is about to wake it), and
 * - for a short window after the display comes back (off or night clock -> normal) or the page
 *   becomes visible again, because the power state the page knows can lag the real one.
 * It never blocks when the power state did not just change. Pure: the caller passes the time.
 */
import type { DisplayMode } from './night-clock.js';

export const WAKE_GUARD_MS = 700;

export interface WakeGuard {
	/** The latest power mode from the server. */
	observe(mode: DisplayMode, now: number): void;
	/** The page became visible again (or was restored from the back/forward cache). */
	resume(now: number): void;
	/** Should a pointer or click event at `now` be swallowed? */
	swallows(now: number): boolean;
}

export function createWakeGuard(windowMs = WAKE_GUARD_MS): WakeGuard {
	let mode: DisplayMode | null = null;
	let until = -Infinity;
	return {
		observe(next, now) {
			if (mode !== null && mode !== 'normal' && next === 'normal') until = now + windowMs;
			mode = next;
		},
		resume(now) {
			until = now + windowMs;
		},
		swallows(now) {
			return mode === 'off' || now < until;
		}
	};
}
