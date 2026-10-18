/**
 * Kitchen timer storage (TMR-1). A handful of short-lived countdowns, so they live in one
 * `settings` row (no table, no migration) that is kept out of backups. State transitions live in
 * `#lib/domain/timers.js`. Every read-modify-write below is synchronous, so two taps never race.
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	addTime,
	isTimerDuration,
	MAX_TIMERS,
	MAX_TIMER_MS,
	pauseTimer,
	resumeTimer,
	startTimer,
	type KitchenTimer
} from '#lib/domain/timers.js';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { publish } from './events.js';
import { LedgerError } from './ledger.js';

export const TIMERS_KEY = 'timers.list';

const invalid = (msg: string) => new LedgerError('invalid', msg);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function listTimers(db: Db): KitchenTimer[] {
	const row = db.select().from(settings).where(eq(settings.key, TIMERS_KEY)).get();
	try {
		const parsed: unknown = row ? JSON.parse(row.value) : [];
		return Array.isArray(parsed) ? (parsed as KitchenTimer[]) : [];
	} catch {
		return [];
	}
}

function store(db: Db, timers: KitchenTimer[], id: string): void {
	const value = JSON.stringify(timers);
	db.insert(settings)
		.values({ key: TIMERS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	publish('timers', { id });
}

/** `id` may come from the client so its optimistic copy and the stored one match. */
export function createTimer(
	db: Db,
	input: { durationMs?: unknown; label?: unknown; id?: unknown },
	now = Date.now()
): KitchenTimer {
	if (!isTimerDuration(input.durationMs))
		throw invalid(`durationMs must be a whole number from 1000 to ${MAX_TIMER_MS}`);
	const id = input.id === undefined ? randomUUID() : input.id;
	if (typeof id !== 'string' || !ID_RE.test(id)) throw invalid('id is not valid');
	const all = listTimers(db);
	const existing = all.find((t) => t.id === id);
	if (existing) return existing;
	if (all.length >= MAX_TIMERS) throw new LedgerError('conflict', 'too many timers');
	const t = startTimer(id, input.durationMs, input.label, now);
	store(db, [...all, t], id);
	return t;
}

export function updateTimer(
	db: Db,
	id: string,
	action: unknown,
	ms: unknown,
	now = Date.now()
): KitchenTimer {
	const all = listTimers(db);
	const t = all.find((x) => x.id === id);
	if (!t) throw new LedgerError('not_found', 'timer not found');
	let next: KitchenTimer;
	if (action === 'pause') next = pauseTimer(t, now);
	else if (action === 'resume') next = resumeTimer(t, now);
	else if (action === 'add') {
		if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 1000 || ms > MAX_TIMER_MS)
			throw invalid('ms must be a number of milliseconds');
		next = addTime(t, ms, now);
	} else throw invalid('action must be pause, resume or add');
	store(
		db,
		all.map((x) => (x.id === id ? next : x)),
		id
	);
	return next;
}

/** Dismiss or cancel. Deleting one that is already gone is fine (two screens tapping at once). */
export function deleteTimer(db: Db, id: string): { ok: true } {
	const all = listTimers(db);
	if (all.some((t) => t.id === id))
		store(
			db,
			all.filter((t) => t.id !== id),
			id
		);
	return { ok: true };
}
