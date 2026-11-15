import { describe, expect, it } from 'vitest';
import {
	groupByMonth,
	monthKey,
	monthLabel,
	parseArtEntries,
	pick,
	stepMonth,
	thenAndNow,
	type ArtEntry
} from './drawing-art-book.js';

const at = (iso: string) => Date.parse(iso);
const e = (id: string, iso: string): ArtEntry => ({
	id,
	createdAt: at(iso),
	src: `/api/notes/${id}/image`
});
const ALL = [
	e('a', '2026-01-10T12:00:00Z'),
	e('b', '2026-03-05T12:00:00Z'),
	e('c', '2026-01-20T12:00:00Z'),
	e('d', '2025-12-31T12:00:00Z')
];

describe('parseArtEntries', () => {
	it('keeps valid entries and drops malformed ones', () => {
		const ok = e('x', '2026-02-01T00:00:00Z');
		expect(
			parseArtEntries([
				ok,
				null,
				'str',
				{ id: '', createdAt: 1, src: '/a' },
				{ id: 'n', createdAt: NaN, src: '/a' },
				{ id: 'n', createdAt: 1, src: 'http://elsewhere/a' },
				{ id: 'n', createdAt: 1 },
				{ ...ok, extra: 1 }
			])
		).toEqual([ok, ok]);
	});
	it('returns nothing for a non-array', () => {
		expect(parseArtEntries(undefined)).toEqual([]);
		expect(parseArtEntries({})).toEqual([]);
	});
});

describe('months', () => {
	it('keys and labels a month', () => {
		expect(monthKey(at('2026-03-05T12:00:00Z'), 'UTC')).toBe('2026-03');
		expect(monthLabel('2026-03')).toBe('March 2026');
		expect(monthLabel('2026-13')).toBe('2026-13 2026');
	});
	it('uses the given zone at a month boundary', () => {
		const t = at('2026-04-01T02:00:00Z');
		expect(monthKey(t, 'UTC')).toBe('2026-04');
		expect(monthKey(t, 'America/Los_Angeles')).toBe('2026-03');
	});
	it('groups newest month first, newest drawing first inside', () => {
		const g = groupByMonth(ALL, 'UTC');
		expect(g.map((m) => m.key)).toEqual(['2026-03', '2026-01', '2025-12']);
		expect(g[1].entries.map((x) => x.id)).toEqual(['c', 'a']);
		expect(g[1].label).toBe('January 2026');
	});
	it('is empty for no drawings and does not mutate the input', () => {
		expect(groupByMonth([])).toEqual([]);
		const copy = [...ALL];
		groupByMonth(ALL, 'UTC');
		expect(ALL).toEqual(copy);
	});
});

describe('thenAndNow', () => {
	it('pairs the earliest with the latest', () => {
		const p = thenAndNow(ALL)!;
		expect([p.then.id, p.now.id]).toEqual(['d', 'b']);
	});
	it('needs two drawings', () => {
		expect(thenAndNow([])).toBeNull();
		expect(thenAndNow([ALL[0]])).toBeNull();
	});
});

describe('pick and stepMonth', () => {
	const g = groupByMonth(ALL, 'UTC');
	it('shows the first drawing of a month on the then side, the last on the now side', () => {
		expect(pick(g[1], 'then')?.id).toBe('a');
		expect(pick(g[1], 'now')?.id).toBe('c');
	});
	it('has nothing for a missing month', () => {
		expect(pick(undefined, 'now')).toBeNull();
		expect(pick({ key: 'k', label: 'k', entries: [] }, 'then')).toBeNull();
	});
	it('steps along the months and stops at the ends', () => {
		expect(stepMonth(g, '2026-01', 1)).toBe('2025-12');
		expect(stepMonth(g, '2025-12', 1)).toBe('2025-12');
		expect(stepMonth(g, '2026-03', -1)).toBe('2026-03');
		expect(stepMonth(g, 'nope', 1)).toBe('2026-03');
		expect(stepMonth([], 'nope', 1)).toBe('nope');
	});
});
