/**
 * Kitchen timers (TMR-1). Pure state transitions: a timer is either running (it has `endsAt`, a
 * server timestamp) or paused (it has `pausedMs` left). The countdown is always computed from
 * `endsAt`, never by ticking a stored value, so a reload or a second screen shows the same time.
 * A timer that has passed `endsAt` is "fired" until someone dismisses (deletes) it.
 */

export interface KitchenTimer {
	id: string;
	/** Optional quick label ("Pasta"); null for an unlabeled timer. */
	label: string | null;
	/** Start length plus any added time, for display only. */
	durationMs: number;
	/** When a running timer ends (ms since epoch); null while paused. */
	endsAt: number | null;
	/** Time left while paused; null while running. */
	pausedMs: number | null;
}

export const TIMER_PRESET_MINUTES = [1, 3, 5, 10, 15, 30] as const;
export const TIMER_LABELS = ['Pasta', 'Oven', 'Eggs', 'Rice', 'Tea'] as const;
export const MIN_TIMER_MS = 1_000;
export const MAX_TIMER_MS = 24 * 60 * 60_000;
export const MAX_TIMERS = 12;
export const TIMER_LABEL_MAX = 20;
export const MINUTE_MS = 60_000;

export const isTimerDuration = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= MIN_TIMER_MS && v <= MAX_TIMER_MS;

/** A trimmed label, or null when empty or not a string. */
export function cleanLabel(v: unknown): string | null {
	const t = typeof v === 'string' ? v.trim().slice(0, TIMER_LABEL_MAX) : '';
	return t === '' ? null : t;
}

const clamp = (ms: number) => Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, Math.round(ms)));

export function startTimer(
	id: string,
	durationMs: number,
	label: unknown,
	now: number
): KitchenTimer {
	const d = clamp(durationMs);
	return { id, label: cleanLabel(label), durationMs: d, endsAt: now + d, pausedMs: null };
}

export const isRunning = (t: KitchenTimer): boolean => t.endsAt !== null;

/** Time left, never negative. */
export const remainingMs = (t: KitchenTimer, now: number): number =>
	t.endsAt === null ? (t.pausedMs ?? 0) : Math.max(0, t.endsAt - now);

/** A running timer whose time is up. A paused timer never fires. */
export const isFired = (t: KitchenTimer, now: number): boolean =>
	t.endsAt !== null && now >= t.endsAt;

export function pauseTimer(t: KitchenTimer, now: number): KitchenTimer {
	if (t.endsAt === null || isFired(t, now)) return t;
	return { ...t, endsAt: null, pausedMs: remainingMs(t, now) };
}

export function resumeTimer(t: KitchenTimer, now: number): KitchenTimer {
	if (t.endsAt !== null) return t;
	return { ...t, endsAt: now + (t.pausedMs ?? 0), pausedMs: null };
}

/** Adds time to a running, paused or fired timer; a fired one restarts from `now`. */
export function addTime(t: KitchenTimer, ms: number, now: number): KitchenTimer {
	const left = remainingMs(t, now);
	const next = clamp(left + ms);
	const durationMs = Math.min(MAX_TIMER_MS, t.durationMs + (next - left));
	return t.endsAt === null
		? { ...t, durationMs, pausedMs: next }
		: { ...t, durationMs, endsAt: now + next };
}

/** Timers that are fired. */
export const firedTimers = (ts: readonly KitchenTimer[], now: number): KitchenTimer[] =>
	ts.filter((t) => isFired(t, now));

/** Soonest to finish first; paused timers after running ones, fired ones at the very front. */
export function sortTimers(ts: readonly KitchenTimer[], now: number): KitchenTimer[] {
	const key = (t: KitchenTimer) => (t.endsAt === null ? Infinity : remainingMs(t, now));
	return [...ts].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

/** "4:05", "1:02:03" (rounded up, so 0:00 only shows once it has fired). */
export function formatRemaining(ms: number): string {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Pasta is done", or "Timer is done" without a label. */
export const doneMessage = (t: KitchenTimer): string => `${t.label ?? 'Timer'} is done`;
