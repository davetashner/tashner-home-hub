import { describe, expect, it } from 'vitest';
import { buildEventIcs, escapeText, foldLine, newUid, utcStamp } from './ics-build.js';
import { parseIcs } from './ics-parse.js';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('escapeText', () => {
	it('escapes backslash, semicolon, comma and newlines', () => {
		expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
	});
});

describe('foldLine', () => {
	it('leaves short lines alone', () => {
		expect(foldLine('SUMMARY:Hi')).toBe('SUMMARY:Hi');
	});
	it('folds at 75 octets and unfolds back to the original', () => {
		const line = `DESCRIPTION:${'x'.repeat(300)}`;
		const folded = foldLine(line);
		const rows = folded.split('\r\n');
		expect(rows.length).toBeGreaterThan(1);
		for (const r of rows) expect(new TextEncoder().encode(r).length).toBeLessThanOrEqual(75);
		expect(unfold(folded)).toBe(line);
	});
	it('never splits a multi-byte character', () => {
		const line = `SUMMARY:${'é😀'.repeat(60)}`;
		const folded = foldLine(line);
		for (const r of folded.split('\r\n'))
			expect(new TextEncoder().encode(r).length).toBeLessThanOrEqual(75);
		expect(unfold(folded)).toBe(line);
	});
});

describe('buildEventIcs', () => {
	it('writes a timed event in UTC with CRLF endings', () => {
		const ics = buildEventIcs(
			{
				title: 'Soccer',
				location: 'Maple Park',
				notes: 'Bring water',
				time: {
					allDay: false,
					startMs: Date.UTC(2026, 9, 20, 21, 0),
					endMs: Date.UTC(2026, 9, 20, 22, 30)
				}
			},
			{ uid: 'abc@hub', now: NOW }
		);
		expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:');
		expect(ics).toContain('UID:abc@hub\r\n');
		expect(ics).toContain('DTSTAMP:20261017T120000Z\r\n');
		expect(ics).toContain('DTSTART:20261020T210000Z\r\n');
		expect(ics).toContain('DTEND:20261020T223000Z\r\n');
		expect(ics).toContain('LOCATION:Maple Park\r\n');
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	});

	it('writes an all-day event with VALUE=DATE and an exclusive end', () => {
		const ics = buildEventIcs(
			{ title: 'Trip', time: { allDay: true, startDate: '2026-12-24', endDate: '2026-12-26' } },
			{ uid: 'u@hub', now: NOW }
		);
		expect(ics).toContain('DTSTART;VALUE=DATE:20261224\r\n');
		expect(ics).toContain('DTEND;VALUE=DATE:20261226\r\n');
		expect(ics).not.toContain('LOCATION');
		expect(ics).not.toContain('DESCRIPTION');
	});

	it('round-trips through the parser (timed)', () => {
		const ics = buildEventIcs(
			{
				title: 'Dinner; with, friends \\ family',
				location: 'Cafe, Main St',
				notes: `Line one\nLine two ${'long '.repeat(40)}é😀`,
				time: {
					allDay: false,
					startMs: Date.UTC(2026, 9, 20, 21, 0),
					endMs: Date.UTC(2026, 9, 20, 22, 0)
				}
			},
			{ uid: 'rt@hub', now: NOW }
		);
		const { events } = parseIcs(ics, 'America/New_York');
		expect(events).toHaveLength(1);
		const e = events[0]!;
		expect(e.uid).toBe('rt@hub');
		expect(e.title).toBe('Dinner; with, friends \\ family');
		expect(e.location).toBe('Cafe, Main St');
		expect(e.notes).toBe(`Line one\nLine two ${'long '.repeat(40)}é😀`.trim());
		expect(e.start).toEqual({ dateTime: '2026-10-20T21:00:00', timeZone: 'UTC' });
		expect(e.end).toEqual({ dateTime: '2026-10-20T22:00:00', timeZone: 'UTC' });
	});

	it('round-trips through the parser (all-day)', () => {
		const ics = buildEventIcs(
			{ title: 'Trip', time: { allDay: true, startDate: '2026-12-24', endDate: '2026-12-26' } },
			{ uid: 'rt2@hub', now: NOW }
		);
		const e = parseIcs(ics, 'UTC').events[0]!;
		expect(e.start).toEqual({ date: '2026-12-24' });
		expect(e.end).toEqual({ date: '2026-12-26' });
	});
});

describe('helpers', () => {
	it('formats UTC stamps', () => {
		expect(utcStamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102T030405Z');
	});
	it('makes uids with the hub domain', () => {
		expect(newUid(() => 'r')).toBe('r@hub');
		expect(newUid()).toMatch(/^[0-9a-f-]{36}@hub$/);
	});
});
