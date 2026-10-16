import { describe, expect, it } from 'vitest';
import { mapGoogleEvent, mapTime, parseRecurrence } from './google-map.js';

describe('mapTime', () => {
	it('maps all-day, zoned, offset-only and bad values', () => {
		expect(mapTime(undefined)).toBeUndefined();
		expect(mapTime({})).toBeUndefined();
		expect(mapTime({ dateTime: 'garbage' })).toBeUndefined();
		expect(mapTime({ date: '2026-09-01' })).toEqual({ date: '2026-09-01' });
		expect(
			mapTime({ dateTime: '2026-09-01T10:00:00-04:00', timeZone: 'America/New_York' })
		).toEqual({ dateTime: '2026-09-01T10:00:00', timeZone: 'America/New_York' });
		expect(mapTime({ dateTime: '2026-09-01T10:00:00-04:00' })).toEqual({
			dateTime: '2026-09-01T14:00:00',
			timeZone: 'UTC'
		});
		expect(mapTime({ dateTime: '2026-09-01T10:00:00-04:00', timeZone: 'Not/AZone' })).toEqual({
			dateTime: '2026-09-01T14:00:00',
			timeZone: 'UTC'
		});
	});
});

describe('parseRecurrence', () => {
	it('splits RRULE, EXDATE and RDATE in all forms', () => {
		const r = parseRecurrence(
			[
				'RRULE:FREQ=WEEKLY;BYDAY=MO',
				'RRULE:FREQ=DAILY',
				'EXDATE;TZID=America/New_York:20260907T100000,20260914T100000',
				'EXDATE:20260921T140000Z',
				'EXDATE;VALUE=DATE:20260928',
				'RDATE;TZID=Bogus/Zone:20261001T090000',
				'EXDATE:nonsense',
				'NOCOLON',
				'DTSTART:20260901T100000Z'
			],
			'Europe/Paris'
		);
		expect(r.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
		expect(r.exdates).toEqual([
			{ dateTime: '2026-09-07T10:00:00', timeZone: 'America/New_York' },
			{ dateTime: '2026-09-14T10:00:00', timeZone: 'America/New_York' },
			{ dateTime: '2026-09-21T14:00:00', timeZone: 'UTC' },
			{ date: '2026-09-28' }
		]);
		expect(r.rdates).toEqual([{ dateTime: '2026-10-01T09:00:00', timeZone: 'Europe/Paris' }]);
	});
	it('handles missing input', () => {
		expect(parseRecurrence(undefined)).toEqual({ exdates: [], rdates: [] });
	});
});

describe('mapGoogleEvent', () => {
	it('maps a recurring master', () => {
		const e = mapGoogleEvent({
			id: 'm1',
			summary: ' Soccer ',
			location: 'Field',
			description: 'Bring water',
			start: { dateTime: '2026-09-01T17:00:00-04:00', timeZone: 'America/New_York' },
			end: { dateTime: '2026-09-01T18:00:00-04:00', timeZone: 'America/New_York' },
			recurrence: ['RRULE:FREQ=WEEKLY', 'EXDATE;TZID=America/New_York:20260908T170000']
		});
		expect(e).toEqual({
			uid: 'm1',
			title: 'Soccer',
			start: { dateTime: '2026-09-01T17:00:00', timeZone: 'America/New_York' },
			end: { dateTime: '2026-09-01T18:00:00', timeZone: 'America/New_York' },
			location: 'Field',
			notes: 'Bring water',
			status: 'confirmed',
			rrule: 'FREQ=WEEKLY',
			exdates: [{ dateTime: '2026-09-08T17:00:00', timeZone: 'America/New_York' }]
		});
	});
	it('maps RDATE-only masters and untitled tentative events', () => {
		const e = mapGoogleEvent({
			id: 'x',
			status: 'tentative',
			start: { date: '2026-09-01' },
			recurrence: ['RDATE;VALUE=DATE:20260905']
		});
		expect(e).toMatchObject({
			title: '(No title)',
			status: 'tentative',
			rdates: [{ date: '2026-09-05' }]
		});
		expect(e?.rrule).toBeUndefined();
	});
	it('maps an override to its master uid with a recurrenceId', () => {
		const e = mapGoogleEvent({
			id: 'm1_20260908T210000Z',
			recurringEventId: 'm1',
			originalStartTime: { dateTime: '2026-09-08T17:00:00-04:00', timeZone: 'America/New_York' },
			summary: 'Soccer (moved)',
			start: { dateTime: '2026-09-08T18:00:00-04:00', timeZone: 'America/New_York' }
		});
		expect(e).toMatchObject({
			uid: 'm1',
			recurrenceId: { dateTime: '2026-09-08T17:00:00', timeZone: 'America/New_York' },
			start: { dateTime: '2026-09-08T18:00:00', timeZone: 'America/New_York' }
		});
		expect(e?.rrule).toBeUndefined();
	});
	it('maps a stripped cancelled instance via its original start', () => {
		const e = mapGoogleEvent({
			id: 'm1_x',
			status: 'cancelled',
			recurringEventId: 'm1',
			originalStartTime: { date: '2026-09-15' }
		});
		expect(e).toMatchObject({ uid: 'm1', status: 'cancelled', start: { date: '2026-09-15' } });
	});
	it('skips events without id or start', () => {
		expect(mapGoogleEvent({ summary: 'no id', start: { date: '2026-09-01' } })).toBeNull();
		expect(mapGoogleEvent({ id: 'a' })).toBeNull();
		expect(mapGoogleEvent({ id: 'a', status: 'cancelled' })).toBeNull();
	});
});
