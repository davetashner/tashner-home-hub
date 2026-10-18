/**
 * Edits an existing event's iCalendar text in place (CAL-9).
 *
 * The original VEVENT is parsed and only the fields the hub edits are replaced (title, times,
 * location, notes). Everything else Apple stored is kept as it was: attendees, alarms, URL,
 * `X-APPLE-*` properties, VTIMEZONE blocks, the UID. Regenerating the event from scratch would
 * silently drop those. The hub also bumps SEQUENCE and refreshes DTSTAMP / LAST-MODIFIED, as
 * RFC 5545 asks of a changed event.
 */
import ICAL from 'ical.js';
import { foldLine, type NewEvent } from './ics-build.js';

/** Why the hub will not edit an object, if it will not. */
export type Uneditable = 'recurring' | 'unreadable';

function vevents(root: ICAL.Component): ICAL.Component[] {
	return root.getAllSubcomponents('vevent');
}

function parseRoot(raw: string): ICAL.Component | null {
	try {
		const root = new ICAL.Component(ICAL.parse(raw));
		return root.name === 'vcalendar' ? root : null;
	} catch {
		return null;
	}
}

/** `null` when the object is one plain VEVENT the hub can edit. */
export function uneditableReason(raw: string): Uneditable | null {
	const root = parseRoot(raw);
	if (!root) return 'unreadable';
	const events = vevents(root);
	if (events.length === 0) return 'unreadable';
	// More than one VEVENT means a master with overrides: that is a repeating event.
	if (events.length > 1) return 'recurring';
	const ev = events[0]!;
	for (const p of ['rrule', 'rdate', 'recurrence-id', 'exrule']) {
		if (ev.hasProperty(p)) return 'recurring';
	}
	return null;
}

/** Re-folds every content line at 75 octets, whatever the parser library emitted. */
function refold(text: string): string {
	const logical = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
	return logical
		.filter((l, i) => l !== '' || i < logical.length - 1)
		.map(foldLine)
		.join('\r\n');
}

/**
 * Returns the object's text with the edited fields replaced. Throws if the object is not an
 * editable single VEVENT (check `uneditableReason` first for a friendly message).
 */
export function modifyEventIcs(raw: string, edit: NewEvent, now: number): string {
	const reason = uneditableReason(raw);
	if (reason) throw new Error(`Cannot edit this event: ${reason}`);
	const root = parseRoot(raw)!;
	const ev = vevents(root)[0]!;

	const text = (name: string, value: string | undefined) => {
		if (value) ev.updatePropertyWithValue(name, value);
		else ev.removeAllProperties(name);
	};
	const previousLocation = ev.getFirstPropertyValue('location');
	text('summary', edit.title);
	text('location', edit.location);
	text('description', edit.notes);
	// Apple's map pin describes the old address; keep it only if the place is unchanged.
	if ((previousLocation ?? undefined) !== edit.location) {
		ev.removeAllProperties('x-apple-structured-location');
	}

	ev.removeAllProperties('dtstart');
	ev.removeAllProperties('dtend');
	ev.removeAllProperties('duration');
	const t = edit.time;
	if (t.allDay) {
		ev.addPropertyWithValue('dtstart', ICAL.Time.fromDateString(t.startDate));
		ev.addPropertyWithValue('dtend', ICAL.Time.fromDateString(t.endDate));
	} else {
		ev.addPropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(t.startMs), true));
		ev.addPropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(t.endMs), true));
	}

	const stamp = ICAL.Time.fromJSDate(new Date(now), true);
	ev.updatePropertyWithValue('dtstamp', stamp);
	ev.updatePropertyWithValue('last-modified', stamp);
	const seq = Number(ev.getFirstPropertyValue('sequence'));
	ev.updatePropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1);

	return refold(root.toString()) + '\r\n';
}
