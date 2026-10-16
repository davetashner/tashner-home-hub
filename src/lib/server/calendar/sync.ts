import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarSources, events, settings } from '../db/schema.js';
import { diffEvents, scopedId, type Planned, type StoredEvent } from '../domain/calendar/diff.js';
import { expandAll } from '../domain/calendar/expand.js';
import type { Window } from '../domain/calendar/types.js';
import { createProvider, type CalendarProvider, type CalendarSource } from './provider.js';

const DAY = 86_400_000;
export const WINDOW_PAST_DAYS = 30;
export const WINDOW_FUTURE_DAYS = 180;
export const STALE_AFTER_MS = 30 * 60_000;
const STATUS_KEY = 'calendar.sync.status';

export interface SourceStatus {
	lastAttemptAt: number;
	lastSuccessAt: number | null;
	lastError: string | null;
}

export interface SyncDeps {
	now?: () => number;
	provider?: (source: CalendarSource) => CalendarProvider | Promise<CalendarProvider>;
}

export function syncWindow(now: number): Window {
	return { start: now - WINDOW_PAST_DAYS * DAY, end: now + WINDOW_FUTURE_DAYS * DAY };
}

export function readStatuses(db: Db): Record<string, SourceStatus> {
	const row = db.select().from(settings).where(eq(settings.key, STATUS_KEY)).get();
	return row ? (JSON.parse(row.value) as Record<string, SourceStatus>) : {};
}

function writeStatus(db: Db, sourceId: string, status: SourceStatus): void {
	const all = { ...readStatuses(db), [sourceId]: status };
	const value = JSON.stringify(all);
	db.insert(settings)
		.values({ key: STATUS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

interface CalendarMapping {
	externalId: string;
	memberId?: string | null;
	/** Absent means selected; `false` means discovered but not shown (iCloud/Google pickers). */
	selected?: boolean;
}

function parseCalendars(json: string): CalendarMapping[] {
	const v: unknown = JSON.parse(json);
	return Array.isArray(v) ? (v as CalendarMapping[]).filter((c) => c.selected !== false) : [];
}

/** Syncs one source. Never throws: failures are recorded in the source's status. */
export async function syncSource(
	db: Db,
	source: CalendarSource,
	deps: SyncDeps = {}
): Promise<SourceStatus> {
	const now = (deps.now ?? Date.now)();
	const prev = readStatuses(db)[source.id];
	const status: SourceStatus = {
		lastAttemptAt: now,
		lastSuccessAt: prev?.lastSuccessAt ?? source.lastSyncAt ?? null,
		lastError: null
	};
	const errors: string[] = [];
	try {
		const w = syncWindow(now);
		const mappings = parseCalendars(source.calendars);
		const provider = await (deps.provider ?? createProvider)(source);
		const planned: Planned[] = [];
		const fetched = new Set<string>();
		for (const cal of mappings) {
			try {
				const raw = await provider.fetchEvents(cal.externalId, w);
				const memberIds = JSON.stringify(cal.memberId ? [cal.memberId] : []);
				for (const inst of expandAll(raw, w)) {
					planned.push({
						...inst,
						externalId: scopedId(cal.externalId, inst.externalId),
						memberIds
					});
				}
				fetched.add(cal.externalId);
			} catch (e) {
				errors.push(`${cal.externalId}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		const selected = new Set(mappings.map((m) => m.externalId));
		db.transaction((tx) => {
			const stored = tx.select().from(events).where(eq(events.sourceId, source.id)).all();
			const diff = diffEvents(stored as StoredEvent[], planned, w, fetched, selected);
			for (const row of diff.inserts)
				tx.insert(events)
					.values({ id: randomUUID(), sourceId: source.id, ...row })
					.run();
			for (const u of diff.updates) tx.update(events).set(u.row).where(eq(events.id, u.id)).run();
			for (const id of diff.deleteIds) tx.delete(events).where(eq(events.id, id)).run();
		});
	} catch (e) {
		errors.push(e instanceof Error ? e.message : String(e));
	}
	if (errors.length === 0) {
		status.lastSuccessAt = now;
		db.update(calendarSources)
			.set({ lastSyncAt: now })
			.where(eq(calendarSources.id, source.id))
			.run();
	} else {
		status.lastError = errors.join('; ').slice(0, 500);
	}
	writeStatus(db, source.id, status);
	return status;
}

export async function syncAll(db: Db, deps: SyncDeps = {}): Promise<Record<string, SourceStatus>> {
	const result: Record<string, SourceStatus> = {};
	for (const source of db.select().from(calendarSources).all()) {
		result[source.id] = await syncSource(db, source, deps);
	}
	return result;
}

let inFlight: Promise<Record<string, SourceStatus>> | undefined;

/** Single-flight: a call while a run is in progress joins that run instead of starting another. */
export function runSync(db: Db, deps: SyncDeps = {}): Promise<Record<string, SourceStatus>> {
	inFlight ??= syncAll(db, deps).finally(() => {
		inFlight = undefined;
	});
	return inFlight;
}
