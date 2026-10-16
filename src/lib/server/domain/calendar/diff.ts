import type { Instance, Window } from './types.js';

export interface StoredEvent {
	id: string;
	externalId: string;
	title: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	recurrence: string | null;
	location: string | null;
	notes: string | null;
	memberIds: string;
}

export interface Planned extends Instance {
	memberIds: string;
}

export interface Diff {
	inserts: Planned[];
	updates: { id: string; row: Planned }[];
	deleteIds: string[];
}

/** Calendar prefix of a stored external id (`<encoded calendar id>::<uid>::<instance>`). */
export function calendarOf(externalId: string): string {
	const i = externalId.indexOf('::');
	return i < 0 ? '' : decodeURIComponent(externalId.slice(0, i));
}

export function scopedId(calendarId: string, instanceId: string): string {
	return `${encodeURIComponent(calendarId)}::${instanceId}`;
}

const FIELDS = [
	'title',
	'startsAt',
	'endsAt',
	'allDay',
	'recurrence',
	'location',
	'notes',
	'memberIds'
] as const;

/**
 * Plans the writes that make the stored events match `incoming`.
 * Stored rows are deleted when they overlap `w`, belong to a calendar in `fetched`
 * (successfully read) and are absent from `incoming`, or when their calendar is no longer
 * selected (not in `selected`).
 */
export function diffEvents(
	stored: StoredEvent[],
	incoming: Planned[],
	w: Window,
	fetched: ReadonlySet<string>,
	selected: ReadonlySet<string>
): Diff {
	const byId = new Map(stored.map((s) => [s.externalId, s]));
	const want = new Set(incoming.map((i) => i.externalId));
	const diff: Diff = { inserts: [], updates: [], deleteIds: [] };
	for (const row of incoming) {
		const cur = byId.get(row.externalId);
		if (!cur) diff.inserts.push(row);
		else if (FIELDS.some((f) => cur[f] !== row[f])) diff.updates.push({ id: cur.id, row });
	}
	for (const s of stored) {
		if (want.has(s.externalId)) continue;
		const cal = calendarOf(s.externalId);
		const inWindow =
			s.endsAt > s.startsAt
				? s.startsAt < w.end && s.endsAt > w.start
				: s.startsAt >= w.start && s.startsAt < w.end;
		if (!selected.has(cal) || (fetched.has(cal) && inWindow)) diff.deleteIds.push(s.id);
	}
	return diff;
}
