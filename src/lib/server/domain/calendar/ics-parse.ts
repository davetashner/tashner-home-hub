import ICAL from 'ical.js';
import type { RemoteEvent, RemoteTime } from './types.js';

export class IcsParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IcsParseError';
	}
}

export interface ParsedIcs {
	/** `X-WR-CALNAME`, when present. */
	name?: string;
	events: RemoteEvent[];
	/** VEVENTs that could not be understood and were left out. */
	skipped: number;
}

/** Windows (Outlook/Exchange) zone names mapped to IANA. Covers the common North American and European zones. */
export const WINDOWS_ZONES: Record<string, string> = {
	UTC: 'UTC',
	'Eastern Standard Time': 'America/New_York',
	'Central Standard Time': 'America/Chicago',
	'Mountain Standard Time': 'America/Denver',
	'US Mountain Standard Time': 'America/Phoenix',
	'Pacific Standard Time': 'America/Los_Angeles',
	'Alaskan Standard Time': 'America/Anchorage',
	'Hawaiian Standard Time': 'Pacific/Honolulu',
	'Atlantic Standard Time': 'America/Halifax',
	'GMT Standard Time': 'Europe/London',
	'W. Europe Standard Time': 'Europe/Berlin',
	'Central Europe Standard Time': 'Europe/Budapest',
	'Central European Standard Time': 'Europe/Warsaw',
	'Romance Standard Time': 'Europe/Paris',
	'India Standard Time': 'Asia/Kolkata',
	'China Standard Time': 'Asia/Shanghai',
	'Tokyo Standard Time': 'Asia/Tokyo',
	'AUS Eastern Standard Time': 'Australia/Sydney',
	'New Zealand Standard Time': 'Pacific/Auckland'
};

function validZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Maps a TZID to an IANA zone: as-is, Windows name, or the VTIMEZONE's `X-LIC-LOCATION`. */
function resolveZone(tzid: string, custom: Map<string, string>, fallback: string): string {
	const cleaned = tzid.replace(/^\//, '');
	if (validZone(cleaned)) return cleaned;
	return WINDOWS_ZONES[cleaned] ?? custom.get(tzid) ?? fallback;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dateOf = (t: ICAL.Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
const wallOf = (t: ICAL.Time) => `${dateOf(t)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;

interface Ctx {
	custom: Map<string, string>;
	householdZone: string;
}

function toRemote(prop: ICAL.Property, value: ICAL.Time, ctx: Ctx): RemoteTime {
	if (value.isDate) return { date: dateOf(value) };
	const dateTime = wallOf(value);
	if (value.zone === ICAL.Timezone.utcTimezone) return { dateTime, timeZone: 'UTC' };
	const tzid = prop.getParameter('tzid');
	if (typeof tzid === 'string') {
		return { dateTime, timeZone: resolveZone(tzid, ctx.custom, ctx.householdZone) };
	}
	return { dateTime, timeZone: ctx.householdZone }; // floating
}

function timeProp(ev: ICAL.Component, name: string, ctx: Ctx): RemoteTime | undefined {
	const prop = ev.getFirstProperty(name);
	const v = prop?.getFirstValue();
	return prop && v instanceof ICAL.Time ? toRemote(prop, v, ctx) : undefined;
}

function timeList(ev: ICAL.Component, name: string, ctx: Ctx): RemoteTime[] {
	const out: RemoteTime[] = [];
	for (const prop of ev.getAllProperties(name)) {
		for (const v of prop.getValues()) {
			if (v instanceof ICAL.Time) out.push(toRemote(prop, v, ctx));
		}
	}
	return out;
}

function text(ev: ICAL.Component, name: string): string | undefined {
	const v = ev.getFirstPropertyValue(name);
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** DTEND, or DTSTART + DURATION. */
function endOf(ev: ICAL.Component, ctx: Ctx): RemoteTime | undefined {
	const end = timeProp(ev, 'dtend', ctx);
	if (end) return end;
	const dur = ev.getFirstPropertyValue('duration');
	const startProp = ev.getFirstProperty('dtstart');
	const start = startProp?.getFirstValue();
	if (!(dur instanceof ICAL.Duration) || !(start instanceof ICAL.Time)) return undefined;
	const t = start.clone();
	t.addDuration(dur);
	return toRemote(startProp!, t, ctx);
}

function convert(ev: ICAL.Component, ctx: Ctx): RemoteEvent | null {
	const uid = text(ev, 'uid');
	const start = timeProp(ev, 'dtstart', ctx);
	if (!uid || !start) return null;
	const out: RemoteEvent = { uid, title: text(ev, 'summary') ?? '(no title)', start };
	const end = endOf(ev, ctx);
	if (end) out.end = end;
	const rule = ev.getFirstPropertyValue('rrule');
	if (rule instanceof ICAL.Recur) out.rrule = rule.toString();
	const exdates = timeList(ev, 'exdate', ctx);
	if (exdates.length) out.exdates = exdates;
	const rdates = timeList(ev, 'rdate', ctx);
	if (rdates.length) out.rdates = rdates;
	const rid = timeProp(ev, 'recurrence-id', ctx);
	if (rid) out.recurrenceId = rid;
	const location = text(ev, 'location');
	if (location) out.location = location;
	const notes = text(ev, 'description');
	if (notes) out.notes = notes;
	const status = text(ev, 'status')?.toLowerCase();
	if (status === 'cancelled' || status === 'tentative' || status === 'confirmed') {
		out.status = status;
	}
	return out;
}

/** Parses an iCalendar feed into provider-neutral events. Throws IcsParseError if it is not a calendar. */
export function parseIcs(source: string, householdZone: string): ParsedIcs {
	let root: ICAL.Component;
	try {
		root = new ICAL.Component(ICAL.parse(source));
	} catch {
		throw new IcsParseError('The file is not a valid iCalendar (.ics) feed');
	}
	if (root.name !== 'vcalendar') throw new IcsParseError('The file is not an iCalendar feed');

	const custom = new Map<string, string>();
	for (const tz of root.getAllSubcomponents('vtimezone')) {
		const tzid = text(tz, 'tzid');
		const loc = text(tz, 'x-lic-location');
		if (tzid && loc && validZone(loc)) custom.set(tzid, loc);
	}
	const ctx: Ctx = { custom, householdZone };
	const events: RemoteEvent[] = [];
	let skipped = 0;
	for (const vevent of root.getAllSubcomponents('vevent')) {
		try {
			const ev = convert(vevent, ctx);
			if (ev) events.push(ev);
			else skipped++;
		} catch {
			skipped++;
		}
	}
	const name = text(root, 'x-wr-calname');
	return { ...(name ? { name } : {}), events, skipped };
}
