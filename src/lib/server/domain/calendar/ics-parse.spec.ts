import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IcsParseError, parseIcs } from './ics-parse.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const HOME = 'America/Denver';
const parsed = parseIcs(fixture('school.ics'), HOME);
const byUid = (uid: string) => parsed.events.filter((e) => e.uid === uid);

describe('parseIcs', () => {
	it('reads the calendar name and skips events without a UID', () => {
		expect(parsed.name).toBe('Example Elementary');
		expect(parsed.skipped).toBe(1);
	});

	it('parses a weekly rule with EXDATE, location and notes', () => {
		const master = byUid('band@example.com').find((e) => !e.recurrenceId)!;
		expect(master).toMatchObject({
			title: 'Band practice',
			start: { dateTime: '2026-01-05T15:30:00', timeZone: 'America/Chicago' },
			end: { dateTime: '2026-01-05T16:45:00', timeZone: 'America/Chicago' },
			rrule: 'FREQ=WEEKLY;BYDAY=MO',
			exdates: [{ dateTime: '2026-01-12T15:30:00', timeZone: 'America/Chicago' }],
			location: 'Music room',
			notes: 'Bring instruments'
		});
	});

	it('parses overrides and cancelled instances', () => {
		const overrides = byUid('band@example.com').filter((e) => e.recurrenceId);
		expect(overrides).toHaveLength(2);
		expect(overrides[0]).toMatchObject({
			title: 'Band practice (gym)',
			recurrenceId: { dateTime: '2026-01-19T15:30:00' }
		});
		expect(overrides[1]).toMatchObject({ status: 'cancelled' });
	});

	it('parses multi-day all-day events ', () => {
		expect(byUid('break@example.com')[0]).toMatchObject({
			start: { date: '2026-03-16' },
			end: { date: '2026-03-21' }
		});
	});

	it('maps VTIMEZONE names via X-LIC-LOCATION, with DURATION and RDATE', () => {
		expect(byUid('custom@example.com')[0]).toMatchObject({
			start: { timeZone: 'America/Chicago' },
			end: { dateTime: '2026-02-10T19:30:00', timeZone: 'America/Chicago' },
			rdates: [{ dateTime: '2026-03-10T18:00:00', timeZone: 'America/Chicago' }]
		});
	});

	it('maps Windows zone names to IANA', () => {
		expect(byUid('win@example.com')[0]!.start).toEqual({
			dateTime: '2026-02-02T09:00:00',
			timeZone: 'America/New_York'
		});
	});

	it('puts floating and unknown-zone times in the household zone', () => {
		expect(byUid('float@example.com')[0]).toMatchObject({
			start: { dateTime: '2026-02-03T10:00:00', timeZone: HOME },
			status: 'tentative'
		});
		expect(byUid('unknown@example.com')[0]!.start).toMatchObject({ timeZone: HOME });
	});

	it('keeps UTC times as UTC', () => {
		expect(byUid('utc@example.com')[0]!.start).toEqual({
			dateTime: '2026-02-04T15:00:00',
			timeZone: 'UTC'
		});
	});

	it('rejects malformed input and non-calendar documents', () => {
		expect(() => parseIcs(fixture('malformed.ics'), HOME)).toThrow(IcsParseError);
		expect(() => parseIcs('BEGIN:VEVENT\nUID:a\nEND:VEVENT\n', HOME)).toThrow(IcsParseError);
	});

	it('tolerates unnamed calendars and events without a start', () => {
		const r = parseIcs(
			'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR\n',
			HOME
		);
		expect(r).toEqual({ events: [], skipped: 1 });
	});
});
