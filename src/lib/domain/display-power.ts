/**
 * Display power (hub-xcr.5, SLP-1..3): the screen's desired state from the sleep schedule, the
 * household time zone and the latest "sleep now" / "wake" events. Pure: no storage, no clock.
 *
 * Decisions (also in the PR and kiosk/README.md):
 * - A night belongs to the day it ENDS on. It uses the weekend schedule when the wake-up morning
 *   is a Saturday or Sunday, so Friday and Saturday bedtimes are weekend bedtimes and Sunday
 *   night is a weekday bedtime. Both its sleep time and its wake time come from that schedule.
 * - Sleep later than wake (21:30 -> 06:30) crosses midnight. Sleep earlier than wake (01:00 ->
 *   07:00) is a window on the wake day itself. Sleep equal to wake means no night.
 * - Times are household wall-clock times. A time skipped by spring-forward lands on the hour
 *   after it; a time repeated by fall-back means its first occurrence.
 * - "Sleep now" keeps the screen off until the next scheduled wake-up (the end of the night it
 *   falls in, or of the coming night), or until a touch wakes it. With the schedule off it lasts
 *   until a touch.
 * - A touch wake during a night keeps the screen on for the re-sleep timeout, then the night
 *   resumes (a touch while on starts the timeout again). A touch during the day just leaves it on.
 */

export const SLEEP_SCHEDULE_KEY = 'display.sleep-schedule';
export const SLEEP_NOW_KEY = 'display.sleep-now-at';
export const WAKE_KEY = 'display.wake-at';

export interface SleepTimes {
	/** 24-hour "HH:MM" the screen turns off. */
	sleep: string;
	/** 24-hour "HH:MM" the screen turns back on. */
	wake: string;
}

export interface SleepSchedule {
	enabled: boolean;
	weekday: SleepTimes;
	weekend: SleepTimes;
	/** Minutes a touch-woken screen stays on during the night. */
	resleepMinutes: number;
}

export const DEFAULT_SLEEP_SCHEDULE: SleepSchedule = {
	enabled: true,
	weekday: { sleep: '21:30', wake: '06:30' },
	weekend: { sleep: '21:30', wake: '06:30' },
	resleepMinutes: 2
};

export const RESLEEP_MIN = 1;
export const RESLEEP_MAX = 60;

export type PowerReason = 'schedule' | 'sleep-now' | 'wake' | 'disabled';

export interface DisplayPower {
	power: 'on' | 'off';
	reason: PowerReason;
	/** ISO timestamp of the next change this state predicts; absent when none is planned. */
	until?: string;
}

/** The latest override events, as epoch milliseconds (absent: never happened). */
export interface PowerEvents {
	sleepNowAt?: number | null;
	wakeAt?: number | null;
}

const isHhmm = (v: unknown): v is string =>
	typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const isResleep = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= RESLEEP_MIN && v <= RESLEEP_MAX;

const timesOrDefault = (v: unknown, fallback: SleepTimes): SleepTimes => {
	const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
	return {
		sleep: isHhmm(o.sleep) ? o.sleep : fallback.sleep,
		wake: isHhmm(o.wake) ? o.wake : fallback.wake
	};
};

/** A stored value, field by field, falling back to the defaults for anything invalid. */
export function resolveSleepSchedule(stored: unknown): SleepSchedule {
	const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
	const d = DEFAULT_SLEEP_SCHEDULE;
	return {
		enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
		weekday: timesOrDefault(o.weekday, d.weekday),
		weekend: timesOrDefault(o.weekend, d.weekend),
		resleepMinutes: isResleep(o.resleepMinutes) ? o.resleepMinutes : d.resleepMinutes
	};
}

/** Flat PUT body: any of enabled, weekdaySleep, weekdayWake, weekendSleep, weekendWake, resleepMinutes. */
export interface SleepSchedulePatch {
	enabled?: boolean;
	weekdaySleep?: string;
	weekdayWake?: string;
	weekendSleep?: string;
	weekendWake?: string;
	resleepMinutes?: number;
}

const TIME_FIELDS = ['weekdaySleep', 'weekdayWake', 'weekendSleep', 'weekendWake'] as const;

/** Validates a PUT body; returns the patch or an error message. Unknown fields are ignored. */
export function parseSleepPatch(body: Record<string, unknown>): SleepSchedulePatch | string {
	const patch: SleepSchedulePatch = {};
	if (body.enabled !== undefined) {
		if (typeof body.enabled !== 'boolean') return 'enabled must be true or false';
		patch.enabled = body.enabled;
	}
	for (const f of TIME_FIELDS) {
		const v = body[f];
		if (v === undefined) continue;
		if (!isHhmm(v)) return `${f} must be a 24-hour time like 21:30`;
		patch[f] = v;
	}
	if (body.resleepMinutes !== undefined) {
		if (!isResleep(body.resleepMinutes))
			return `resleepMinutes must be a whole number from ${RESLEEP_MIN} to ${RESLEEP_MAX}`;
		patch.resleepMinutes = body.resleepMinutes;
	}
	return patch;
}

export function applySleepPatch(base: SleepSchedule, patch: SleepSchedulePatch): SleepSchedule {
	return {
		enabled: patch.enabled ?? base.enabled,
		weekday: {
			sleep: patch.weekdaySleep ?? base.weekday.sleep,
			wake: patch.weekdayWake ?? base.weekday.wake
		},
		weekend: {
			sleep: patch.weekendSleep ?? base.weekend.sleep,
			wake: patch.weekendWake ?? base.weekend.wake
		},
		resleepMinutes: patch.resleepMinutes ?? base.resleepMinutes
	};
}

/* ---------- time zone math ---------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(zone, f);
	}
	return f;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(zone: string, instant: number): number {
	const p: Record<string, number> = {};
	for (const part of formatter(zone).formatToParts(new Date(instant)))
		if (part.type !== 'literal') p[part.type] = Number(part.value);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a zone's wall clock reads `y-m-d` + `minutes` (day overflow is fine). */
export function zonedInstant(zone: string, y: number, m: number, d: number, minutes: number) {
	const wall = Date.UTC(y, m - 1, d, 0, minutes);
	const day = 86_400_000;
	const before = offsetAt(zone, wall - day);
	const after = offsetAt(zone, wall + day);
	const valid = [before, after]
		.map((o) => wall - o)
		.filter((t) => offsetAt(zone, t) === wall - t)
		.sort((x, y2) => x - y2);
	// Repeated hour (fall back): the earlier instant. Skipped hour (spring forward): no
	// candidate reads that wall time, so use the offset from before the gap.
	return valid.length ? valid[0] : wall - before;
}

export interface Ymd {
	y: number;
	m: number;
	d: number;
}

export function localYmd(zone: string, instant: number): Ymd {
	const p: Record<string, number> = {};
	for (const part of formatter(zone).formatToParts(new Date(instant)))
		if (part.type !== 'literal') p[part.type] = Number(part.value);
	return { y: p.year, m: p.month, d: p.day };
}

export function addDays(date: Ymd, days: number): Ymd {
	const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
	return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const isWeekend = (date: Ymd) => {
	const dow = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
	return dow === 0 || dow === 6;
};

/* ---------- nights ---------- */

export interface Night {
	/** Instants (ms): the screen goes off at `start` and comes back at `end`. */
	start: number;
	end: number;
}

/** The night that ends on `wakeDay`, or null when its sleep and wake times are the same. */
export function nightEndingOn(schedule: SleepSchedule, zone: string, wakeDay: Ymd): Night | null {
	const times = isWeekend(wakeDay) ? schedule.weekend : schedule.weekday;
	const sleep = minutesOf(times.sleep);
	const wake = minutesOf(times.wake);
	if (sleep === wake) return null;
	const startDay = sleep > wake ? addDays(wakeDay, -1) : wakeDay;
	return {
		start: zonedInstant(zone, startDay.y, startDay.m, startDay.d, sleep),
		end: zonedInstant(zone, wakeDay.y, wakeDay.m, wakeDay.d, wake)
	};
}

/** Nights that could touch `now`: those ending today through three days ahead, in order. */
function nearbyNights(schedule: SleepSchedule, zone: string, now: number): Night[] {
	const today = localYmd(zone, now);
	const nights: Night[] = [];
	for (let i = -1; i <= 3; i++) {
		const night = nightEndingOn(schedule, zone, addDays(today, i));
		if (night && night.end > night.start) nights.push(night);
	}
	return nights.sort((a, b) => a.start - b.start);
}

function nightsAround(schedule: SleepSchedule, zone: string, now: number, event: number): Night[] {
	const all = [...nearbyNights(schedule, zone, now), ...nearbyNights(schedule, zone, event)];
	const seen = new Set<number>();
	return all
		.filter((n) => !seen.has(n.start) && seen.add(n.start))
		.sort((a, b) => a.start - b.start);
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Where the schedule alone puts the screen at `now`. */
function scheduleState(nights: Night[], now: number): DisplayPower & { night: Night | null } {
	const inside = nights.find((n) => n.start <= now && now < n.end);
	if (inside) return { power: 'off', reason: 'schedule', until: iso(inside.end), night: inside };
	const next = nights.find((n) => n.start > now);
	return {
		power: 'on',
		reason: 'schedule',
		until: next ? iso(next.start) : undefined,
		night: null
	};
}

/** The next scheduled wake-up at or after `at`: the end of its night, or of the coming one. */
function nextWakeAfter(nights: Night[], at: number): number | null {
	const n = nights.find((x) => x.end > at);
	return n ? n.end : null;
}

/** Desired power for the display at `now`. */
export function displayPower(
	now: number,
	zone: string,
	schedule: SleepSchedule,
	events: PowerEvents = {}
): DisplayPower {
	const past = (t: number | null | undefined) => (typeof t === 'number' && t <= now ? t : null);
	const sleepAt = past(events.sleepNowAt);
	const wakeAt = past(events.wakeAt);
	const newest = Math.max(sleepAt ?? -Infinity, wakeAt ?? -Infinity);

	if (!schedule.enabled) {
		if (sleepAt !== null && (wakeAt === null || sleepAt > wakeAt))
			return { power: 'off', reason: 'sleep-now' };
		return { power: 'on', reason: 'disabled' };
	}

	// Include the night around the event, which may already be over by `now`.
	const nights = nightsAround(schedule, zone, now, newest === -Infinity ? now : newest);
	const base = scheduleState(nights, now);

	if (sleepAt !== null && sleepAt === newest) {
		const wake = nextWakeAfter(nights, sleepAt);
		if (wake === null) return { power: 'off', reason: 'sleep-now' };
		if (now < wake) return { power: 'off', reason: 'sleep-now', until: iso(wake) };
	} else if (wakeAt !== null) {
		const atWake = scheduleState(nights, wakeAt);
		if (atWake.night) {
			const stayOn = Math.min(wakeAt + schedule.resleepMinutes * 60_000, atWake.night.end);
			if (now < stayOn) return { power: 'on', reason: 'wake', until: iso(stayOn) };
		}
	}
	return { power: base.power, reason: base.reason, until: base.until };
}
