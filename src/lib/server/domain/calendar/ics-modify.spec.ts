import { describe, expect, it } from 'vitest';
import { modifyEventIcs, uneditableReason } from './ics-modify.js';
import { parseIcs } from './ics-parse.js';
import type { NewEvent } from './ics-build.js';

const wrap = (body: string) =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iOS//EN\r\n${body}END:VCALENDAR\r\n`;
const PHONE = wrap(
	[
		'BEGIN:VTIMEZONE',
		'TZID:America/New_York',
		'END:VTIMEZONE',
		'BEGIN:VEVENT',
		'UID:phone-1',
		'DTSTAMP:20260101T000000Z',
		'SEQUENCE:2',
		'DTSTART;TZID=America/New_York:20261020T170000',
		'DTEND;TZID=America/New_York:20261020T180000',
		'SUMMARY:Old title',
		'LOCATION:Old hall',
		'X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:1.0,2.0',
		'ATTENDEE;CN=Pat Example:mailto:pat@example.test',
		'URL:https://example.test/rsvp',
		'BEGIN:VALARM',
		'ACTION:DISPLAY',
		'TRIGGER:-PT15M',
		'END:VALARM',
		'END:VEVENT',
		''
	].join('\r\n')
);
const timed = (over: Partial<NewEvent> = {}): NewEvent => ({
	title: 'New title',
	time: { allDay: false, startMs: Date.UTC(2026, 9, 21, 1, 0), endMs: Date.UTC(2026, 9, 21, 2, 0) },
	...over
});
const NOW = Date.UTC(2026, 9, 18, 12, 30, 15);

describe('modifyEventIcs', () => {
	it('replaces the edited fields and keeps the UID', () => {
		const out = modifyEventIcs(PHONE, timed({ location: 'New hall', notes: 'Bring music' }), NOW);
		expect(out).toContain('UID:phone-1');
		expect(out).toContain('SUMMARY:New title');
		expect(out).toContain('LOCATION:New hall');
		expect(out).toContain('DESCRIPTION:Bring music');
		expect(out).toContain('DTSTART:20261021T010000Z');
		expect(out).toContain('DTEND:20261021T020000Z');
		expect(out).not.toContain('TZID=America/New_York:2026');
		const [ev] = parseIcs(out, 'America/New_York').events;
		expect(ev).toMatchObject({ uid: 'phone-1', title: 'New title', location: 'New hall' });
	});

	it('keeps properties the hub does not edit', () => {
		const out = modifyEventIcs(PHONE, timed({ location: 'Old hall' }), NOW);
		for (const kept of [
			'ATTENDEE;CN=Pat Example:mailto:pat@example.test',
			'URL:https://example.test/rsvp',
			'BEGIN:VALARM',
			'TRIGGER:-PT15M',
			'BEGIN:VTIMEZONE',
			'X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:1.0,2.0'
		]) {
			expect(out).toContain(kept);
		}
	});

	it('drops the old map pin when the place changes, and removes cleared fields', () => {
		const out = modifyEventIcs(PHONE, timed(), NOW);
		expect(out).not.toContain('X-APPLE-STRUCTURED-LOCATION');
		expect(out).not.toContain('LOCATION:');
	});

	it('bumps SEQUENCE and refreshes DTSTAMP and LAST-MODIFIED', () => {
		const out = modifyEventIcs(PHONE, timed(), NOW);
		expect(out).toContain('SEQUENCE:3');
		expect(out).toContain('DTSTAMP:20261018T123015Z');
		expect(out).toContain('LAST-MODIFIED:20261018T123015Z');
	});

	it('writes all-day events as VALUE=DATE with an exclusive end, replacing DURATION', () => {
		const raw = PHONE.replace(/DTEND;TZID[^\r]*\r\n/, 'DURATION:PT1H\r\n');
		const out = modifyEventIcs(
			raw,
			timed({ time: { allDay: true, startDate: '2026-10-22', endDate: '2026-10-24' } }),
			NOW
		);
		expect(out).toContain('DTSTART;VALUE=DATE:20261022');
		expect(out).toContain('DTEND;VALUE=DATE:20261024');
		expect(out).not.toContain('DURATION');
	});

	it('escapes text and folds long lines at 75 octets', () => {
		const out = modifyEventIcs(
			PHONE,
			timed({ title: 'Cake; candles, \\ and more', notes: `${'é'.repeat(80)}\nsecond line` }),
			NOW
		);
		expect(out).toContain(String.raw`SUMMARY:Cake\; candles\, \\ and more`);
		const lines = out.split('\r\n');
		expect(Math.max(...lines.map((l) => new TextEncoder().encode(l).length))).toBeLessThanOrEqual(
			75
		);
		const [ev] = parseIcs(out, 'UTC').events;
		expect(ev?.notes).toBe(`${'é'.repeat(80)}\nsecond line`);
		expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
	});

	it('refuses repeating and unreadable objects', () => {
		const rrule = PHONE.replace('SUMMARY:', 'RRULE:FREQ=WEEKLY\r\nSUMMARY:');
		const rdate = PHONE.replace('SUMMARY:', 'RDATE:20261101T170000Z\r\nSUMMARY:');
		const override = PHONE.replace(
			'END:VCALENDAR',
			'BEGIN:VEVENT\r\nUID:phone-1\r\nRECURRENCE-ID:20261027T170000Z\r\nDTSTART:20261027T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR'
		);
		expect(uneditableReason(PHONE)).toBeNull();
		expect(uneditableReason(rrule)).toBe('recurring');
		expect(uneditableReason(rdate)).toBe('recurring');
		expect(uneditableReason(override)).toBe('recurring');
		expect(uneditableReason('garbage')).toBe('unreadable');
		expect(() => modifyEventIcs(rrule, timed(), NOW)).toThrow(/recurring/);
	});
});
