import { and, asc, gt, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarSources, events, members } from '../db/schema.js';
import { readStatuses, STALE_AFTER_MS } from './sync.js';

export interface CalendarEventView {
	id: string;
	sourceId: string;
	title: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	recurrence: string | null;
	location: string | null;
	notes: string | null;
	members: { id: string; name: string; color: string }[];
}

/** Merged events overlapping [start, end), sorted by start, with member colors resolved. */
export function listEvents(db: Db, start: number, end: number): CalendarEventView[] {
	const byId = new Map(
		db
			.select()
			.from(members)
			.all()
			.map((m) => [m.id, m])
	);
	const rows = db
		.select()
		.from(events)
		.where(
			or(
				and(lt(events.startsAt, end), gt(events.endsAt, start)),
				sql`${events.endsAt} <= ${events.startsAt} AND ${events.startsAt} >= ${start} AND ${events.startsAt} < ${end}`
			)
		)
		.orderBy(asc(events.startsAt), asc(events.title))
		.all();
	return rows.map(({ memberIds, ...e }) => ({
		...e,
		members: (JSON.parse(memberIds) as string[]).flatMap((id) => {
			const m = byId.get(id);
			return m ? [{ id: m.id, name: m.name, color: m.color }] : [];
		})
	}));
}

export interface SourceSyncStatus {
	sourceId: string;
	label: string;
	lastSyncAt: number | null;
	lastError: string | null;
	stale: boolean;
}

export function syncStatus(db: Db, now = Date.now()) {
	const statuses = readStatuses(db);
	const sources = db
		.select()
		.from(calendarSources)
		.all()
		.map((s): SourceSyncStatus => {
			const lastSyncAt = s.lastSyncAt;
			return {
				sourceId: s.id,
				label: s.label,
				lastSyncAt,
				lastError: statuses[s.id]?.lastError ?? null,
				stale: lastSyncAt === null || now - lastSyncAt > STALE_AFTER_MS
			};
		});
	return { sources, stale: sources.some((s) => s.stale) };
}
