import { describe, expect, it } from 'vitest';
import type { CalEvent } from './layout.js';
import {
	filterEvents,
	parseSelection,
	pruneSelection,
	serializeSelection,
	toggleMember
} from './member-filter.js';

const ev = (id: string, members: string[]): CalEvent => ({
	id,
	title: id,
	startsAt: 0,
	endsAt: 1,
	allDay: false,
	location: null,
	notes: null,
	members: members.map((m) => ({ id: m, name: m, color: 'member-1' }))
});

const events = [ev('a', ['m1']), ev('b', ['m2', 'm3']), ev('c', []), ev('d', ['m3'])];

describe('filterEvents', () => {
	it('returns everything when nothing is selected', () => {
		expect(filterEvents(events, [])).toBe(events);
	});
	it('keeps events that match one selected member', () => {
		expect(filterEvents(events, ['m1']).map((e) => e.id)).toEqual(['a', 'c']);
	});
	it('keeps shared events if any selected member is on them', () => {
		expect(filterEvents(events, ['m3']).map((e) => e.id)).toEqual(['b', 'c', 'd']);
		expect(filterEvents(events, ['m1', 'm2']).map((e) => e.id)).toEqual(['a', 'b', 'c']);
	});
	it('keeps family-wide events with no member while filtering', () => {
		expect(filterEvents(events, ['m9']).map((e) => e.id)).toEqual(['c']);
	});
});

describe('toggleMember', () => {
	it('adds then removes', () => {
		const on = toggleMember([], 'm1');
		expect(on).toEqual(['m1']);
		expect(toggleMember(on, 'm2')).toEqual(['m1', 'm2']);
		expect(toggleMember(on, 'm1')).toEqual([]);
	});
});

describe('persistence helpers', () => {
	it('round-trips a selection', () => {
		expect(parseSelection(serializeSelection(['m1', 'm2']))).toEqual(['m1', 'm2']);
	});
	it('treats bad input as no filter', () => {
		expect(parseSelection(null)).toEqual([]);
		expect(parseSelection('')).toEqual([]);
		expect(parseSelection('{oops')).toEqual([]);
		expect(parseSelection('{"a":1}')).toEqual([]);
	});
	it('keeps only unique non-empty strings', () => {
		expect(parseSelection('["m1",2,"m1","",null,"m2"]')).toEqual(['m1', 'm2']);
	});
	it('prunes unknown members', () => {
		expect(pruneSelection(['m1', 'gone'], ['m1', 'm2'])).toEqual(['m1']);
	});
});
