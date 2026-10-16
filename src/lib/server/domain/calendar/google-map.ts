import type { RemoteEvent, RemoteTime } from './types.js';
import { parseWall, toWall } from './time.js';

/** The subset of the Google Calendar API `Event` resource the hub reads. */
export interface GoogleTime {
	date?: string;
	dateTime?: string;
	timeZone?: string;
}

export interface GoogleEvent {
	id?: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	start?: GoogleTime;
	end?: GoogleTime;
	recurrence?: string[];
	recurringEventId?: string;
	originalStartTime?: GoogleTime;
}

const pad = (n: number) => String(n).padStart(2, '0');

function wallString(ms: number): string {
	const d = new Date(ms);
	return (
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
		`T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
	);
}

function validZone(tz: string | undefined): string | undefined {
	if (!tz) return undefined;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return tz;
	} catch {
		return undefined;
	}
}

/** `date` is all-day; `dateTime` carries an offset, so convert to wall time in `timeZone` (else UTC). */
export function mapTime(t: GoogleTime | undefined): RemoteTime | undefined {
	if (!t) return undefined;
	if (t.date) return { date: t.date };
	if (!t.dateTime) return undefined;
	const instant = Date.parse(t.dateTime);
	if (Number.isNaN(instant)) return undefined;
	const tz = validZone(t.timeZone);
	if (!tz) return { dateTime: wallString(instant), timeZone: 'UTC' };
	return { dateTime: wallString(toWall(instant, tz)), timeZone: tz };
}

export interface Recurrence {
	rrule?: string;
	exdates: RemoteTime[];
	rdates: RemoteTime[];
}

const BASIC_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const BASIC_DT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

function parseBasic(v: string, tzid: string | undefined, fallbackZone: string): RemoteTime | null {
	let m = BASIC_DATE.exec(v);
	if (m) return { date: `${m[1]}-${m[2]}-${m[3]}` };
	m = BASIC_DT.exec(v);
	if (!m) return null;
	const dateTime = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
	parseWall(dateTime);
	if (m[7]) return { dateTime, timeZone: 'UTC' };
	return { dateTime, timeZone: validZone(tzid) ?? fallbackZone };
}

/**
 * Splits Google's `recurrence[]` (RRULE / EXDATE / RDATE lines) into engine fields.
 * `fallbackZone` is used for floating EXDATE/RDATE values (the event's own zone).
 */
export function parseRecurrence(lines: string[] | undefined, fallbackZone = 'UTC'): Recurrence {
	const out: Recurrence = { exdates: [], rdates: [] };
	for (const raw of lines ?? []) {
		const colon = raw.indexOf(':');
		if (colon < 0) continue;
		const [name, ...params] = raw.slice(0, colon).split(';');
		const value = raw.slice(colon + 1).trim();
		switch (name!.toUpperCase()) {
			case 'RRULE':
				out.rrule ??= value;
				break;
			case 'EXDATE':
			case 'RDATE': {
				const tzid = params.find((p) => p.toUpperCase().startsWith('TZID='))?.slice(5);
				const target = name!.toUpperCase() === 'EXDATE' ? out.exdates : out.rdates;
				for (const v of value.split(',')) {
					const t = parseBasic(v.trim(), tzid, fallbackZone);
					if (t) target.push(t);
				}
				break;
			}
		}
	}
	return out;
}

const zoneOf = (t: RemoteTime | undefined): string => (t && 'timeZone' in t ? t.timeZone : 'UTC');

/**
 * Maps one Google event (fetched with `singleEvents=false`) to the engine's shape.
 * A master keeps its own id as uid; an override takes its master's id and a `recurrenceId`.
 * Returns null for events with no usable start.
 */
export function mapGoogleEvent(g: GoogleEvent): RemoteEvent | null {
	if (!g.id) return null;
	const recurrenceId = mapTime(g.originalStartTime);
	const isOverride = Boolean(g.recurringEventId && recurrenceId);
	const cancelled = g.status === 'cancelled';
	// Cancelled instances can arrive stripped down to just their original start.
	const start = mapTime(g.start) ?? (cancelled ? recurrenceId : undefined);
	if (!start) return null;
	const ev: RemoteEvent = {
		uid: isOverride ? g.recurringEventId! : g.id,
		title: g.summary?.trim() || '(No title)',
		start
	};
	const end = mapTime(g.end);
	if (end) ev.end = end;
	if (g.location) ev.location = g.location;
	if (g.description) ev.notes = g.description;
	if (cancelled) ev.status = 'cancelled';
	else if (g.status === 'tentative') ev.status = 'tentative';
	else ev.status = 'confirmed';
	if (isOverride) ev.recurrenceId = recurrenceId!;
	else {
		const rec = parseRecurrence(g.recurrence, zoneOf(start));
		if (rec.rrule) ev.rrule = rec.rrule;
		if (rec.exdates.length) ev.exdates = rec.exdates;
		if (rec.rdates.length) ev.rdates = rec.rdates;
	}
	return ev;
}
