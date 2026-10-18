import { describe, expect, it } from 'vitest';
import {
	cleanText,
	effectiveOwner,
	filterByOwner,
	groupByOwner,
	itemsLeft,
	nextPosition,
	parseOwnerId,
	sortItems,
	withDone
} from './lists.js';

const item = (id: string, done: boolean, position: number) => ({ id, done, position });

describe('lists domain', () => {
	it('cleans text', () => {
		expect(cleanText('  two   eggs ', 20)).toBe('two eggs');
		expect(cleanText('   ', 20)).toBeNull();
		expect(cleanText(5, 20)).toBeNull();
		expect(cleanText('abcd', 3)).toBeNull();
	});
	it('puts unchecked first, then oldest first, without mutating', () => {
		const input = [item('a', true, 0), item('b', false, 2), item('c', false, 1)];
		expect(sortItems(input).map((i) => i.id)).toEqual(['c', 'b', 'a']);
		expect(input[0].id).toBe('a');
	});
	it('numbers new items after the last', () => {
		expect(nextPosition([])).toBe(0);
		expect(nextPosition([item('a', false, 4), item('b', false, 1)])).toBe(5);
	});
	it('checks one item off', () => {
		const out = withDone([item('a', false, 0), item('b', false, 1)], 'b', true);
		expect(out.map((i) => i.done)).toEqual([false, true]);
	});
});

const adults = [
	{ id: 'a1', name: 'Parent One' },
	{ id: 'a2', name: 'Parent Two' }
];
const owned = (id: string, ownerId: string | null, done: boolean[]) => ({
	id,
	ownerId,
	items: done.map((d) => ({ done: d }))
});
const sample = [
	owned('grocery', null, [false, false, true]),
	owned('packing', 'a2', [false]),
	owned('errands', 'a1', [true]),
	owned('gone', 'removed-adult', [false])
];

describe('list owners', () => {
	it('counts what is left', () => {
		expect(itemsLeft(sample[0])).toBe(2);
		expect(itemsLeft(sample[2])).toBe(0);
	});
	it('treats an unknown owner as House', () => {
		expect(effectiveOwner({ ownerId: 'a1' }, adults)).toBe('a1');
		expect(effectiveOwner({ ownerId: 'removed-adult' }, adults)).toBeNull();
		expect(effectiveOwner({ ownerId: null }, adults)).toBeNull();
	});
	it('filters by everyone, one adult or House', () => {
		const ids = (f: string) => filterByOwner(sample, f, adults).map((l) => l.id);
		expect(ids('all')).toEqual(['grocery', 'packing', 'errands', 'gone']);
		expect(ids('a2')).toEqual(['packing']);
		expect(ids('house')).toEqual(['grocery', 'gone']);
		expect(ids('nobody')).toEqual([]);
	});
	it('groups adults in order, then House, with totals and no empty groups', () => {
		const groups = groupByOwner(sample, adults);
		expect(groups.map((g) => [g.label, g.lists.map((l) => l.id), g.left])).toEqual([
			['Parent One', ['errands'], 0],
			['Parent Two', ['packing'], 1],
			['House', ['grocery', 'gone'], 3]
		]);
		expect(groupByOwner([sample[1]], adults).map((g) => g.label)).toEqual(['Parent Two']);
		expect(groupByOwner([], adults)).toEqual([]);
	});
	it('parses the owner value', () => {
		expect(parseOwnerId(null)).toBeNull();
		expect(parseOwnerId('house')).toBeNull();
		expect(parseOwnerId('a1')).toBe('a1');
		expect(parseOwnerId('')).toBeUndefined();
		expect(parseOwnerId(5)).toBeUndefined();
	});
});
