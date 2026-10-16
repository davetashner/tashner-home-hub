import { describe, expect, it } from 'vitest';
import { calendarOf, diffEvents, scopedId, type Planned, type StoredEvent } from './diff.js';

const w = { start: 1000, end: 2000 };
const base = {
	title: 't',
	allDay: false,
	recurrence: null,
	location: null,
	notes: null,
	memberIds: '[]'
};
const planned = (externalId: string, startsAt = 1100): Planned => ({
	...base,
	externalId,
	startsAt,
	endsAt: startsAt + 10
});
const stored = (id: string, externalId: string, startsAt = 1100): StoredEvent => ({
	...planned(externalId, startsAt),
	id
});

describe('scoped ids', () => {
	it('round-trips calendar ids that contain colons', () => {
		const id = scopedId('a::b@x', 'uid::2026');
		expect(calendarOf(id)).toBe('a::b@x');
		expect(calendarOf('legacy')).toBe('');
	});
});

describe('diffEvents', () => {
	const cal = new Set(['c']);
	it('inserts, updates and leaves identical rows alone', () => {
		const s = [stored('1', 'c::a'), stored('2', 'c::b')];
		const inc = [planned('c::a'), { ...planned('c::b'), title: 'new' }, planned('c::n')];
		const d = diffEvents(s, inc, w, cal, cal);
		expect(d.inserts.map((r) => r.externalId)).toEqual(['c::n']);
		expect(d.updates.map((u) => u.id)).toEqual(['2']);
		expect(d.deleteIds).toEqual([]);
	});

	it('deletes in-window rows that disappeared, keeps out-of-window and unfetched ones', () => {
		const s = [
			stored('gone', 'c::gone'),
			stored('old', 'c::old', 100),
			stored('zero', 'c::zero', 1500),
			stored('other', 'd::x')
		];
		const d = diffEvents(s, [], w, cal, new Set(['c', 'd']));
		expect(d.deleteIds.sort()).toEqual(['gone', 'zero']);
	});

	it('deletes rows of deselected calendars regardless of window', () => {
		const d = diffEvents([stored('1', 'e::x', 100)], [], w, cal, cal);
		expect(d.deleteIds).toEqual(['1']);
	});

	it('keeps multi-day rows that overlap the window edge', () => {
		const row = { ...stored('s', 'c::s', 500), endsAt: 1500 };
		expect(diffEvents([row], [], w, cal, cal).deleteIds).toEqual(['s']);
	});
});
