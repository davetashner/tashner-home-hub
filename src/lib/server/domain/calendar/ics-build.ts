/**
 * Builds the iCalendar (RFC 5545) text for a new hub-created event (CAL-9).
 *
 * Timed events are written in UTC (`DTSTART:20261020T210000Z`) rather than `TZID=` plus a
 * VTIMEZONE block. A UTC instant is unambiguous, needs no zone definition (a wrong or missing
 * VTIMEZONE is the classic way for iOS to show an event an hour off), and iOS/macOS convert it to
 * each viewer's own zone. All-day events use `VALUE=DATE` with an exclusive DTEND.
 */

export type NewEventTime =
	| { allDay: true; startDate: string; /** Exclusive, `YYYY-MM-DD`. */ endDate: string }
	| { allDay: false; /** Epoch ms. */ startMs: number; /** Epoch ms. */ endMs: number };

export interface NewEvent {
	title: string;
	location?: string;
	notes?: string;
	time: NewEventTime;
}

export const PRODID = '-//Tashner Home Hub//Calendar//EN';
export const UID_DOMAIN = 'hub';

/** Escapes TEXT per RFC 5545 section 3.3.11: backslash, semicolon, comma, newlines. */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 section 3.1). */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = '';
	let size = 0;
	// The first line holds 75 octets; continuation lines hold 74 plus the leading space.
	let limit = 75;
	for (const ch of line) {
		const n = encoder.encode(ch).length;
		if (size + n > limit) {
			parts.push(current);
			current = '';
			size = 0;
			limit = 74;
		}
		current += ch;
		size += n;
	}
	parts.push(current);
	return parts.join('\r\n ');
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `20261020T210000Z` */
export function utcStamp(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}

const dateValue = (date: string) => date.replace(/-/g, '');

export function newUid(random: () => string = () => crypto.randomUUID()): string {
	return `${random()}@${UID_DOMAIN}`;
}

export function buildEventIcs(event: NewEvent, opts: { uid: string; now: number }): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${PRODID}`,
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${opts.uid}`,
		`DTSTAMP:${utcStamp(opts.now)}`
	];
	const t = event.time;
	if (t.allDay) {
		lines.push(`DTSTART;VALUE=DATE:${dateValue(t.startDate)}`);
		lines.push(`DTEND;VALUE=DATE:${dateValue(t.endDate)}`);
	} else {
		lines.push(`DTSTART:${utcStamp(t.startMs)}`);
		lines.push(`DTEND:${utcStamp(t.endMs)}`);
	}
	lines.push(`SUMMARY:${escapeText(event.title)}`);
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
	if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
	lines.push('END:VEVENT', 'END:VCALENDAR');
	return lines.map(foldLine).join('\r\n') + '\r\n';
}
