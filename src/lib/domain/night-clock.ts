/**
 * Night clock (hub-gj6.10, SLP-4): an optional alternative to a fully-off screen at night. Pure:
 * decides which of three modes a wall display is in and where the clock sits (burn-in nudge).
 *
 * - `off`: the monitor is powered down (Sleep now, or the night with night clock disabled).
 * - `night-clock`: the scheduled night with night clock enabled: the screen stays powered and
 *   shows only a very dim, warm, large clock.
 * - `normal`: the regular app (daytime, schedule off, or a touch-woken screen until re-sleep).
 */
import { time } from './calendar-view/format.js';
import type { CalEvent } from './calendar-view/layout.js';
import {
	addDays,
	dateKeyOf,
	dayStartMs,
	daysBetween,
	utcDateKey,
	weekday
} from './calendar-view/zone.js';
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

/** The slice of a calendar event the night clock needs. */
export type NightEvent = Pick<CalEvent, 'title' | 'startsAt' | 'endsAt' | 'allDay'>;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The local day word: Today, Tomorrow, or the weekday name further out. */
function dayWord(now: number, wakeDay: string, zone: string): string {
	const ahead = daysBetween(dateKeyOf(now, zone), wakeDay);
	return ahead <= 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : WEEKDAYS[weekday(wakeDay)];
}

/** The local day span the morning's fetch must cover: [start, end) of the wake-up day. */
export function morningRange(wakeAt: number, zone: string): { start: number; end: number } {
	const day = dateKeyOf(wakeAt, zone);
	return { start: dayStartMs(day, zone), end: dayStartMs(addDays(day, 1), zone) };
}

/**
 * The line under the night clock (SLP-4): the first timed event that starts at or after the
 * upcoming wake-up on the wake-up's local day, e.g. "Tomorrow 7:15 AM · Swim practice". Events that
 * started before waking (even if still running) do not count. With no timed event, an all-day
 * event covering that day is named instead ("Tomorrow · School holiday"). Otherwise null.
 */
export function nextMorningLine(
	events: readonly NightEvent[],
	wakeAt: number,
	now: number,
	zone: string
): string | null {
	const wakeDay = dateKeyOf(wakeAt, zone);
	const { end } = morningRange(wakeAt, zone);
	const word = dayWord(now, wakeDay, zone);
	const label = (e: NightEvent) => e.title.trim() || 'Event';

	const timed = events
		.filter((e) => !e.allDay && e.startsAt >= wakeAt && e.startsAt < end)
		.sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title))[0];
	if (timed) return `${word} ${time(timed.startsAt, zone)} · ${label(timed)}`;

	const allDay = events
		.filter((e) => {
			if (!e.allDay) return false;
			const first = utcDateKey(e.startsAt);
			const last = e.endsAt > e.startsAt ? addDays(utcDateKey(e.endsAt), -1) : first;
			return daysBetween(first, wakeDay) >= 0 && daysBetween(wakeDay, last) >= 0;
		})
		.sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title))[0];
	return allDay ? `${word} · ${label(allDay)}` : null;
}
