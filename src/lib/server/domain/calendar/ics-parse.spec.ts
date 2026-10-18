import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IcsParseError, parseIcs } from './ics-parse.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const HOME = 'America/Denver';
// Parsed per call (not at module load) so mutation testing can attribute coverage to each test.
const school = () => parseIcs(fixture('school.ics'), HOME);
const byUid = (uid: string) => school().events.filter((e) => e.uid === uid);

describe('parseIcs', () => {
	it('reads the calendar name and skips events without a UID', () => {
		expect(school().name).toBe('Example Elementary');
		expect(school().skipped).toBe(1);
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

const wrap = (...lines: string[]) =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const vevent = (...lines: string[]) =>
	wrap('BEGIN:VEVENT', 'UID:t@example.com', 'SUMMARY:T', ...lines, 'END:VEVENT');
const one = (...lines: string[]) => {
	const r = parseIcs(vevent(...lines), HOME);
	expect(r.events).toHaveLength(1);
	return r.events[0]!;
};

describe('parseIcs recurrence properties', () => {
	it('passes RRULE through as a normalized string', () => {
		expect(one('DTSTART:20260105T090000Z', 'RRULE:FREQ=DAILY;COUNT=3').rrule).toBe(
			'FREQ=DAILY;COUNT=3'
		);
		expect(
			one('DTSTART:20260105T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260301T000000Z')
				.rrule
		).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260301T000000Z');
		expect(
			one('DTSTART:20260105T090000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15;INTERVAL=2').rrule
		).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15');
		expect(one('DTSTART:20260105T090000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1SU').rrule).toBe(
			'FREQ=MONTHLY;BYDAY=1SU'
		);
	});

	it('omits recurrence fields on a plain event', () => {
		const e = one('DTSTART:20260105T090000Z');
		expect(e).toEqual({
			uid: 't@example.com',
			title: 'T',
			start: { dateTime: '2026-01-05T09:00:00', timeZone: 'UTC' }
		});
		expect('rrule' in e || 'exdates' in e || 'rdates' in e || 'recurrenceId' in e).toBe(false);
		expect('end' in e || 'location' in e || 'notes' in e || 'status' in e).toBe(false);
	});

	it('collects multiple EXDATE lines and comma-separated values, each with its own TZID', () => {
		const e = one(
			'DTSTART;TZID=America/New_York:20260105T090000',
			'RRULE:FREQ=DAILY',
			'EXDATE;TZID=America/New_York:20260106T090000,20260107T090000',
			'EXDATE:20260108T140000Z',
			'EXDATE;VALUE=DATE:20260109'
		);
		expect(e.exdates).toEqual([
			{ dateTime: '2026-01-06T09:00:00', timeZone: 'America/New_York' },
			{ dateTime: '2026-01-07T09:00:00', timeZone: 'America/New_York' },
			{ dateTime: '2026-01-08T14:00:00', timeZone: 'UTC' },
			{ date: '2026-01-09' }
		]);
	});

	it('collects RDATEs, including multiple values', () => {
		const e = one(
			'DTSTART:20260105T090000Z',
			'RDATE:20260201T090000Z,20260202T090000Z',
			'RDATE;TZID=America/Denver:20260301T090000'
		);
		expect(e.rdates).toEqual([
			{ dateTime: '2026-02-01T09:00:00', timeZone: 'UTC' },
			{ dateTime: '2026-02-02T09:00:00', timeZone: 'UTC' },
			{ dateTime: '2026-03-01T09:00:00', timeZone: 'America/Denver' }
		]);
	});

	it('reads RECURRENCE-ID as a start-shaped time, all-day or timed', () => {
		expect(
			one(
				'DTSTART;TZID=America/Chicago:20260105T100000',
				'RECURRENCE-ID;TZID=America/Chicago:20260105T090000'
			).recurrenceId
		).toEqual({ dateTime: '2026-01-05T09:00:00', timeZone: 'America/Chicago' });
		expect(
			one('DTSTART;VALUE=DATE:20260105', 'RECURRENCE-ID;VALUE=DATE:20260105').recurrenceId
		).toEqual({
			date: '2026-01-05'
		});
	});
});

describe('parseIcs times and zones', () => {
	it('keeps wall-clock times across the America/New_York DST boundaries', () => {
		const spring = one(
			'DTSTART;TZID=America/New_York:20260308T013000',
			'DTEND;TZID=America/New_York:20260308T033000'
		);
		expect(spring.start).toEqual({ dateTime: '2026-03-08T01:30:00', timeZone: 'America/New_York' });
		expect(spring.end).toEqual({ dateTime: '2026-03-08T03:30:00', timeZone: 'America/New_York' });
		const fall = one(
			'DTSTART;TZID=America/New_York:20261101T013000',
			'DTEND;TZID=America/New_York:20261101T023000'
		);
		expect(fall.start).toEqual({ dateTime: '2026-11-01T01:30:00', timeZone: 'America/New_York' });
		expect(fall.end).toEqual({ dateTime: '2026-11-01T02:30:00', timeZone: 'America/New_York' });
	});

	it('resolves a leading-slash TZID and a Windows name used with a VTIMEZONE fallback', () => {
		expect(one('DTSTART;TZID=/America/New_York:20260105T090000').start).toMatchObject({
			timeZone: 'America/New_York'
		});
		expect(one('DTSTART;TZID=Pacific Standard Time:20260105T090000').start).toMatchObject({
			timeZone: 'America/Los_Angeles'
		});
		expect(one('DTSTART;TZID=UTC:20260105T090000').start).toMatchObject({ timeZone: 'UTC' });
	});

	it('ignores an invalid X-LIC-LOCATION and a VTIMEZONE without one', () => {
		const ics = wrap(
			'BEGIN:VTIMEZONE',
			'TZID:Bogus One',
			'X-LIC-LOCATION:Not/AZone',
			'END:VTIMEZONE',
			'BEGIN:VTIMEZONE',
			'TZID:Bogus Two',
			'END:VTIMEZONE',
			'BEGIN:VEVENT',
			'UID:a',
			'DTSTART;TZID=Bogus One:20260105T090000',
			'DTEND;TZID=Bogus Two:20260105T100000',
			'END:VEVENT'
		);
		const e = parseIcs(ics, HOME).events[0]!;
		expect(e.start).toMatchObject({ timeZone: HOME });
		expect(e.end).toMatchObject({ timeZone: HOME });
	});

	it('zero-pads every component of the wall time', () => {
		expect(one('DTSTART;TZID=America/Denver:20260102T030405').start).toEqual({
			dateTime: '2026-01-02T03:04:05',
			timeZone: 'America/Denver'
		});
		expect(one('DTSTART;VALUE=DATE:20260102').start).toEqual({ date: '2026-01-02' });
	});

	it('treats floating times as the household zone, whatever it is', () => {
		const r = parseIcs(vevent('DTSTART:20260105T090000'), 'Europe/Paris');
		expect(r.events[0]!.start).toEqual({
			dateTime: '2026-01-05T09:00:00',
			timeZone: 'Europe/Paris'
		});
	});

	it('handles all-day events with exclusive end, and with no end', () => {
		const e = one('DTSTART;VALUE=DATE:20261231', 'DTEND;VALUE=DATE:20270102');
		expect(e.start).toEqual({ date: '2026-12-31' });
		expect(e.end).toEqual({ date: '2027-01-02' });
		const noEnd = one('DTSTART;VALUE=DATE:20260105');
		expect(noEnd.start).toEqual({ date: '2026-01-05' });
		expect(noEnd.end).toBeUndefined();
	});

	it('derives the end from DURATION for timed and all-day events', () => {
		expect(one('DTSTART;TZID=America/Denver:20260105T230000', 'DURATION:PT2H').end).toEqual({
			dateTime: '2026-01-06T01:00:00',
			timeZone: 'America/Denver'
		});
		expect(one('DTSTART:20260105T090000Z', 'DURATION:PT30M').end).toEqual({
			dateTime: '2026-01-05T09:30:00',
			timeZone: 'UTC'
		});
		expect(one('DTSTART;VALUE=DATE:20260105', 'DURATION:P3D').end).toEqual({ date: '2026-01-08' });
	});

	it('prefers DTEND over DURATION', () => {
		expect(one('DTSTART:20260105T090000Z', 'DTEND:20260105T100000Z', 'DURATION:PT5H').end).toEqual({
			dateTime: '2026-01-05T10:00:00',
			timeZone: 'UTC'
		});
	});
});

describe('parseIcs text and status', () => {
	it('unfolds CRLF + space and CRLF + tab continuations', () => {
		const e = one(
			'DTSTART:20260105T090000Z',
			'DESCRIPTION:Hello wo',
			' rld, again',
			'LOCATION:Room',
			'\t 12'
		);
		expect(e.notes).toBe('Hello world, again');
		expect(e.location).toBe('Room 12');
	});

	it('unescapes backslash, semicolon, comma and newline in text', () => {
		const e = parseIcs(
			wrap(
				'BEGIN:VEVENT',
				'UID:a',
				'DTSTART:20260105T090000Z',
				'SUMMARY:A\\\\B\\;C\\,D',
				'DESCRIPTION:line1\\nline2\\Nline3',
				'END:VEVENT'
			),
			HOME
		).events[0]!;
		expect(e.title).toBe('A\\B;C,D');
		expect(e.notes).toBe('line1\nline2\nline3');
	});

	it('trims text and falls back to "(no title)" for a missing or blank summary', () => {
		const withSummary = parseIcs(
			wrap(
				'BEGIN:VEVENT',
				'UID:a',
				'SUMMARY:  padded  ',
				'LOCATION:   ',
				'DESCRIPTION:',
				'DTSTART:20260105T090000Z',
				'END:VEVENT'
			),
			HOME
		).events[0]!;
		expect(withSummary.title).toBe('padded');
		expect(withSummary.location).toBeUndefined();
		expect(withSummary.notes).toBeUndefined();
		for (const summary of ['SUMMARY:   ', null]) {
			const lines = [
				'BEGIN:VEVENT',
				'UID:a',
				...(summary ? [summary] : []),
				'DTSTART:20260105T090000Z',
				'END:VEVENT'
			];
			expect(parseIcs(wrap(...lines), HOME).events[0]!.title).toBe('(no title)');
		}
	});

	it('trims the UID and skips a blank one', () => {
		const ok = parseIcs(
			wrap('BEGIN:VEVENT', 'UID:  x@example.com ', 'DTSTART:20260105T090000Z', 'END:VEVENT'),
			HOME
		);
		expect(ok.events[0]!.uid).toBe('x@example.com');
		const blank = parseIcs(
			wrap('BEGIN:VEVENT', 'UID:   ', 'DTSTART:20260105T090000Z', 'END:VEVENT'),
			HOME
		);
		expect(blank).toEqual({ events: [], skipped: 1 });
	});

	it('reads each status case-insensitively and drops unknown ones', () => {
		expect(one('DTSTART:20260105T090000Z', 'STATUS:confirmed').status).toBe('confirmed');
		expect(one('DTSTART:20260105T090000Z', 'STATUS:Tentative').status).toBe('tentative');
		expect(one('DTSTART:20260105T090000Z', 'STATUS:CANCELLED').status).toBe('cancelled');
		expect(one('DTSTART:20260105T090000Z', 'STATUS:NEEDS-ACTION').status).toBeUndefined();
	});

	it('reads a trimmed calendar name only when it is non-blank', () => {
		expect(parseIcs(wrap('X-WR-CALNAME:  Family  '), HOME)).toEqual({
			name: 'Family',
			events: [],
			skipped: 0
		});
		expect(parseIcs(wrap('X-WR-CALNAME:   '), HOME)).toEqual({ events: [], skipped: 0 });
	});
});

describe('parseIcs malformed input', () => {
	it('rejects text that does not parse, with the parse-failure message', () => {
		expect(() =>
			parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nEND:VCALENDAR\r\n', HOME)
		).toThrow('The file is not a valid iCalendar (.ics) feed');
		expect(() => parseIcs('', HOME)).toThrow(IcsParseError);
	});

	it('rejects a non-VCALENDAR root with its own message', () => {
		expect(() => parseIcs('BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\n', HOME)).toThrow(
			'The file is not an iCalendar feed'
		);
		try {
			parseIcs('BEGIN:VEVENT\r\nEND:VEVENT\r\n', HOME);
		} catch (err) {
			expect((err as Error).name).toBe('IcsParseError');
		}
	});

	it('counts events that fail to convert and keeps the good ones', () => {
		const ics = wrap(
			'BEGIN:VEVENT',
			'UID:good',
			'DTSTART:20260105T090000Z',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'UID:nostart',
			'END:VEVENT',
			'BEGIN:VEVENT',
			'UID:baddate',
			'DTSTART:2026-13-45',
			'END:VEVENT'
		);
		const r = parseIcs(ics, HOME);
		expect(r.events.map((e) => e.uid)).toEqual(['good']);
		expect(r.skipped).toBe(2);
	});

	it('ignores a VEVENT with a duration but no start, and an unreadable DTEND', () => {
		expect(parseIcs(vevent('DURATION:PT1H'), HOME)).toEqual({ events: [], skipped: 1 });
	});

	describe('Outlook feeds', () => {
		const outlook = () => parseIcs(fixture('outlook.ics'), HOME);
		const get = (uid: string) => outlook().events.filter((e) => e.uid === uid);

		it('reads the name and maps Windows time zone names to IANA', () => {
			expect(outlook().name).toBe('Parent One Work');
			expect(outlook().skipped).toBe(0);
			const master = get('standup@example.com').find((e) => !e.recurrenceId)!;
			expect(master.start).toEqual({
				dateTime: '2026-01-05T09:30:00',
				timeZone: 'America/New_York'
			});
			expect(master.exdates).toEqual([
				{ dateTime: '2026-01-12T09:30:00', timeZone: 'America/New_York' }
			]);
			expect(get('lunch@example.com')[0]!.start).toMatchObject({
				timeZone: 'America/Los_Angeles'
			});
		});

		it('keeps RECURRENCE-ID overrides tied to the original instance', () => {
			const override = get('standup@example.com').find((e) => e.recurrenceId)!;
			expect(override.title).toBe('Team standup (moved)');
			expect(override.recurrenceId).toEqual({
				dateTime: '2026-01-19T09:30:00',
				timeZone: 'America/New_York'
			});
		});

		it('turns flagged midnight-to-midnight events into all-day dates', () => {
			expect(get('offsite@example.com')[0]).toMatchObject({
				start: { date: '2026-02-03' },
				end: { date: '2026-02-04' }
			});
			expect(get('holiday@example.com')[0]!.start).toEqual({ date: '2026-02-16' });
		});

		it('leaves unflagged timed events alone', () => {
			expect(get('lunch@example.com')[0]).toMatchObject({
				start: { dateTime: '2026-02-10T12:00:00' },
				end: { dateTime: '2026-02-10T13:00:00' }
			});
		});

		it('does not make a flagged event with a real time all-day', () => {
			const ics = wrap(
				'BEGIN:VEVENT',
				'UID:odd',
				'DTSTART;TZID=Eastern Standard Time:20260203T093000',
				'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
				'END:VEVENT'
			);
			expect(parseIcs(ics, HOME).events[0]!.start).toHaveProperty('dateTime');
		});

		it('converts EXDATE, RDATE and RECURRENCE-ID of a flagged all-day series', () => {
			const ics = wrap(
				'BEGIN:VEVENT',
				'UID:series',
				'DTSTART;TZID=Eastern Standard Time:20260203T000000',
				'DTEND;TZID=Eastern Standard Time:20260204T000000',
				'RRULE:FREQ=DAILY;COUNT=5',
				'EXDATE;TZID=Eastern Standard Time:20260204T000000',
				'RDATE;TZID=Eastern Standard Time:20260301T000000',
				'RECURRENCE-ID;TZID=Eastern Standard Time:20260205T000000',
				'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
				'END:VEVENT'
			);
			expect(parseIcs(ics, HOME).events[0]).toMatchObject({
				exdates: [{ date: '2026-02-04' }],
				rdates: [{ date: '2026-03-01' }],
				recurrenceId: { date: '2026-02-05' }
			});
		});
	});
});
