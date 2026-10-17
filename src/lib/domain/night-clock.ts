/**
 * Night clock (hub-gj6.10, SLP-4): an optional alternative to a fully-off screen at night. Pure:
 * decides which of three modes a wall display is in and where the clock sits (burn-in nudge).
 *
 * - `off`: the monitor is powered down (Sleep now, or the night with night clock disabled).
 * - `night-clock`: the scheduled night with night clock enabled: the screen stays powered and
 *   shows only a very dim, warm, large clock.
 * - `normal`: the regular app (daytime, schedule off, or a touch-woken screen until re-sleep).
 */
import type { DisplayPower } from './display-power.js';

export const NIGHT_CLOCK_KEY = 'display.night-clock';

export type DisplayMode = 'normal' | 'night-clock' | 'off';

/** The stored setting; anything but an explicit `{ enabled: true }` is off. */
export function resolveNightClock(stored: unknown): boolean {
	return (
		!!stored && typeof stored === 'object' && (stored as { enabled?: unknown }).enabled === true
	);
}

/** Validates a PUT body; returns the new setting or an error message. */
export function parseNightClockPatch(body: Record<string, unknown>): boolean | string {
	return typeof body.enabled === 'boolean' ? body.enabled : 'enabled must be true or false';
}

/** What the wall display should show, given the schedule's power decision. */
export function displayMode(power: DisplayPower, nightClock: boolean): DisplayMode {
	if (power.power === 'on') return 'normal';
	return nightClock && power.reason === 'schedule' ? 'night-clock' : 'off';
}

/** Parses the `mode` field of /api/display/power; anything unknown is `normal`. */
export function parseDisplayMode(value: unknown): DisplayMode {
	return value === 'off' || value === 'night-clock' ? value : 'normal';
}

/**
 * Slow burn-in drift: a position in -1..1 on each axis that changes once a minute and wanders
 * the clock around a small area (two incommensurate periods, so it never retraces quickly).
 */
export function nightClockOffset(now: number): { x: number; y: number } {
	const minute = Math.floor(now / 60_000);
	const round = (n: number) => Math.round(n * 100) / 100;
	return {
		x: round(Math.sin((2 * Math.PI * minute) / 37)),
		y: round(Math.sin((2 * Math.PI * minute) / 53))
	};
}
