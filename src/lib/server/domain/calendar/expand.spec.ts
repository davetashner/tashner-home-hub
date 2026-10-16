import { describe, expect, it } from 'vitest';
import { expandAll, expandEvent, externalIdFor } from './expand.js';
import { fromWall, parseWall, toInstant, toWall } from './time.js';
import type { RemoteEvent, Window } from './types.js';

const utc = (s: string) => Date.parse(s);
const NY = 'America/New_York';
const win = (a: string, b: string): Window => ({ start: utc(a), end: utc(b) });
const W = win('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');
const timed = (dateTime: string, timeZone = NY) => ({ dateTime, timeZone });
const iso = (ms: number) => new Date(ms).toISOString();

describe('time helpers', () => {
	it('round-trips wall time and handles DST offsets', () => {
		expect(iso(toInstant(timed('2026-01-15T09:00:00')))).toBe('2026-01-15T14:00:00.000Z');
		expect(iso(toInstant(timed('2026-07-15T09:00')))).toBe('2026-07-15T13:00:00.000Z');
		expect(toWall(utc('2026-07-15T13:00:00Z'), NY)).toBe(parseWall('2026-07-15T09:00:00'));
		expect(fromWall(parseWall('2026-07-15T09:00:00'), 'UTC')).toBe(
			parseWall('2026-07-15T09:00:00')
		);
	});
	it('moves a nonexistent spring-forward time ahead', () => {
		expect(iso(toInstant(timed('2026-03-08T02:30:00')))).toBe('2026-03-08T07:30:00.000Z');
	});
	it('rejects malformed input', () => {
		expect(() => toInstant({ date: 'nope' })).toThrow();
		expect(() => toInstant({ dateTime: 'nope', timeZone: 'UTC' })).toThrow();
	});
});

describe('single events', () => {
	it('normalizes a time-zone event to UTC', () => {
		const [i] = expandEvent(
			[
				{
					uid: 'a',
					title: 'Dentist',
					start: timed('2026-06-01T15:00'),
					end: timed('2026-06-01T16:00')
				}
			],
			W
		);
		expect(iso(i!.startsAt)).toBe('2026-06-01T19:00:00.000Z');
		expect(i!.endsAt - i!.startsAt).toBe(3_600_000);
		expect(i!.externalId).toBe('a::2026-06-01T19:00:00.000Z');
		expect(i!.allDay).toBe(false);
	});

	it('keeps all-day events date-only (no zone shift) and multi-day spans', () => {
		const [one] = expandEvent([{ uid: 'b', title: 'Holiday', start: { date: '2026-07-04' } }], W);
		expect(iso(one!.startsAt)).toBe('2026-07-04T00:00:00.000Z');
		expect(iso(one!.endsAt)).toBe('2026-07-05T00:00:00.000Z');
		expect(one!.allDay).toBe(true);
		expect(one!.externalId).toBe('b::2026-07-04');
		const [trip] = expandEvent(
			[{ uid: 'c', title: 'Trip', start: { date: '2026-08-01' }, end: { date: '2026-08-04' } }],
			W
		);
		expect(trip!.endsAt - trip!.startsAt).toBe(3 * 86_400_000);
	});

	it('includes events only when they overlap the window', () => {
		const ev: RemoteEvent = {
			uid: 'd',
			title: 'x',
			start: { date: '2026-05-01' },
			end: { date: '2026-05-03' }
		};
		expect(expandEvent([ev], win('2026-05-02T00:00:00Z', '2026-05-09T00:00:00Z'))).toHaveLength(1);
		expect(expandEvent([ev], win('2026-05-03T00:00:00Z', '2026-05-09T00:00:00Z'))).toHaveLength(0);
		const zero: RemoteEvent = { uid: 'z', title: 'z', start: timed('2026-05-01T10:00', 'UTC') };
		expect(expandEvent([zero], win('2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z'))).toHaveLength(
			1
		);
		expect(expandEvent([zero], win('2026-05-02T00:00:00Z', '2026-05-03T00:00:00Z'))).toHaveLength(
			0
		);
	});

	it('drops cancelled events', () => {
		expect(
			expandEvent([{ uid: 'e', title: 'x', start: { date: '2026-05-01' }, status: 'cancelled' }], W)
		).toHaveLength(0);
	});
});

describe('recurrence', () => {
	const w = win('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');

	it('expands daily', () => {
		const out = expandEvent(
			[{ uid: 'r', title: 'x', start: timed('2026-03-01T08:00'), rrule: 'FREQ=DAILY;COUNT=5' }],
			w
		);
		expect(out).toHaveLength(5);
	});

	it('expands weekly BYDAY and keeps local time across the DST change', () => {
		const out = expandEvent(
			[
				{
					uid: 'w',
					title: 'Practice',
					start: timed('2026-03-02T17:00'),
					end: timed('2026-03-02T18:00'),
					rrule: 'FREQ=WEEKLY;BYDAY=MO,WE'
				}
			],
			w
		);
		const starts = out.map((i) => iso(i.startsAt));
		expect(out).toHaveLength(9);
		// Before 2026-03-08 (EST, UTC-5): 22:00Z. After (EDT, UTC-4): 21:00Z.
		expect(starts[0]).toBe('2026-03-02T22:00:00.000Z');
		expect(starts[2]).toBe('2026-03-09T21:00:00.000Z');
		expect(out.every((i) => i.endsAt - i.startsAt === 3_600_000)).toBe(true);
		expect(out[0]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
	});

	it('handles fall-back too', () => {
		const out = expandEvent(
			[{ uid: 'f', title: 'x', start: timed('2026-10-30T09:00'), rrule: 'FREQ=DAILY;COUNT=4' }],
			W
		);
		expect(out.map((i) => iso(i.startsAt))).toEqual([
			'2026-10-30T13:00:00.000Z',
			'2026-10-31T13:00:00.000Z',
			'2026-11-01T14:00:00.000Z',
			'2026-11-02T14:00:00.000Z'
		]);
	});

	it('expands monthly and respects UNTIL (UTC form)', () => {
		const out = expandEvent(
			[
				{
					uid: 'm',
					title: 'Bills',
					start: timed('2026-01-15T09:00'),
					rrule: 'FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20260515T140000Z'
				}
			],
			W
		);
		expect(out).toHaveLength(5);
		expect(iso(out[4]!.startsAt)).toBe('2026-05-15T13:00:00.000Z');
	});

	it('expands all-day recurrences on the same date', () => {
		const out = expandEvent(
			[{ uid: 'ad', title: 'Trash', start: { date: '2026-03-02' }, rrule: 'FREQ=WEEKLY;COUNT=3' }],
			w
		);
		expect(out.map((i) => i.externalId)).toEqual([
			'ad::2026-03-02',
			'ad::2026-03-09',
			'ad::2026-03-16'
		]);
	});

	it('applies EXDATE and RDATE', () => {
		const out = expandEvent(
			[
				{
					uid: 'x',
					title: 'x',
					start: timed('2026-03-02T08:00'),
					rrule: 'FREQ=DAILY;COUNT=4',
					exdates: [timed('2026-03-03T08:00')],
					rdates: [timed('2026-03-20T08:00')]
				}
			],
			w
		);
		expect(out.map((i) => iso(i.startsAt).slice(0, 10))).toEqual([
			'2026-03-02',
			'2026-03-04',
			'2026-03-05',
			'2026-03-20'
		]);
	});

	it('supports RDATE-only masters and all-day rdate/exdate', () => {
		const out = expandEvent(
			[
				{
					uid: 'y',
					title: 'y',
					start: { date: '2026-03-02' },
					rrule: 'FREQ=DAILY;COUNT=3',
					exdates: [{ date: '2026-03-03' }],
					rdates: [{ date: '2026-03-10' }]
				}
			],
			w
		);
		expect(out.map((i) => i.externalId)).toEqual([
			'y::2026-03-02',
			'y::2026-03-04',
			'y::2026-03-10'
		]);
	});

	it('replaces an instance with its override, keeping a stable id', () => {
		const master: RemoteEvent = {
			uid: 'o',
			title: 'Piano',
			start: timed('2026-03-02T16:00'),
			end: timed('2026-03-02T17:00'),
			rrule: 'FREQ=WEEKLY;COUNT=3'
		};
		const override: RemoteEvent = {
			uid: 'o',
			title: 'Piano (moved)',
			start: timed('2026-03-10T18:00'),
			end: timed('2026-03-10T19:00'),
			recurrenceId: timed('2026-03-09T16:00')
		};
		const out = expandEvent([master, override], w);
		expect(out).toHaveLength(3);
		const moved = out.find((i) => i.title === 'Piano (moved)')!;
		expect(moved.externalId).toBe(externalIdFor('o', timed('2026-03-09T16:00')));
		expect(iso(moved.startsAt)).toBe('2026-03-10T22:00:00.000Z');
		expect(moved.recurrence).toBe('FREQ=WEEKLY;COUNT=3');
	});

	it('removes cancelled instances and tolerates overrides without a master', () => {
		const master: RemoteEvent = {
			uid: 'c',
			title: 'x',
			start: timed('2026-03-02T16:00'),
			rrule: 'FREQ=WEEKLY;COUNT=3'
		};
		const cancelled: RemoteEvent = {
			...master,
			rrule: undefined,
			recurrenceId: timed('2026-03-09T16:00'),
			start: timed('2026-03-09T16:00'),
			status: 'cancelled'
		};
		expect(expandEvent([master, cancelled], w)).toHaveLength(2);
		const orphan: RemoteEvent = { ...cancelled, status: 'confirmed' };
		const [only] = expandEvent([orphan], w);
		expect(only!.recurrence).toBeNull();
	});

	it('returns nothing for a cancelled master but still honours live overrides', () => {
		const master: RemoteEvent = {
			uid: 'k',
			title: 'x',
			start: timed('2026-03-02T16:00'),
			rrule: 'FREQ=DAILY;COUNT=3',
			status: 'cancelled'
		};
		expect(expandEvent([master], w)).toHaveLength(0);
	});
});

describe('expandAll', () => {
	it('groups by UID and de-duplicates', () => {
		const a: RemoteEvent = { uid: 'a', title: 'A', start: { date: '2026-03-02' } };
		const b: RemoteEvent = { uid: 'b', title: 'B', start: { date: '2026-03-03' } };
		expect(expandAll([a, b, a], W)).toHaveLength(2);
	});
});
