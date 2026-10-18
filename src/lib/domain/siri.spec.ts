import { describe, expect, it } from 'vitest';
import {
	RateLimiter,
	bearerToken,
	isScope,
	matchName,
	normalizeName,
	parseStars,
	spokenList
} from './siri.js';

const lists = ['Grocery', 'To-Do', 'Packing', 'Party Prep'];
const find = (q: unknown) => matchName(q, lists, (l) => l);

describe('normalizeName', () => {
	it('folds case, punctuation, articles, "list" and plurals', () => {
		expect(normalizeName('The Groceries List')).toBe('grocery');
		expect(normalizeName('to do')).toBe('todo');
		expect(normalizeName('To-Do')).toBe('todo');
		expect(normalizeName('boxes')).toBe('box');
		expect(normalizeName('Milk')).toBe('milk');
		expect(normalizeName('bus')).toBe('bus');
	});
});

describe('matchName', () => {
	it('matches loosely', () => {
		expect(find('groceries')).toEqual({ kind: 'match', value: 'Grocery' });
		expect(find('GROCERY LIST')).toEqual({ kind: 'match', value: 'Grocery' });
		expect(find('to do list')).toEqual({ kind: 'match', value: 'To-Do' });
		expect(find('pack')).toEqual({ kind: 'match', value: 'Packing' });
		expect(find('party')).toEqual({ kind: 'match', value: 'Party Prep' });
		expect(find('the packing list please')).toEqual({ kind: 'match', value: 'Packing' });
	});
	it('reports none and ambiguous', () => {
		expect(find('garage')).toEqual({ kind: 'none' });
		expect(find('')).toEqual({ kind: 'none' });
		expect(find(42)).toEqual({ kind: 'none' });
		expect(find('p')).toEqual({ kind: 'none' });
		const kids = ['Maya', 'Mason', 'Mason'];
		expect(matchName('ma', kids, (k) => k)).toMatchObject({ kind: 'ambiguous' });
		expect(matchName('mason', kids, (k) => k)).toMatchObject({ kind: 'ambiguous' });
		expect(matchName('maya', ['Maya', 'Mayakovsky'], (k) => k)).toEqual({
			kind: 'match',
			value: 'Maya'
		});
	});
});

describe('helpers', () => {
	it('spokenList', () => {
		expect(spokenList(['a'])).toBe('a');
		expect(spokenList(['a', 'b'])).toBe('a and b');
		expect(spokenList(['a', 'b', 'c'])).toBe('a, b and c');
	});
	it('parseStars', () => {
		expect(parseStars(undefined)).toBeUndefined();
		expect(parseStars('')).toBeUndefined();
		expect(parseStars(3)).toBe(3);
		expect(parseStars(' 2 ')).toBe(2);
		for (const bad of [0, 6, 1.5, 'x', '9', true]) expect(parseStars(bad)).toBeNull();
	});
	it('bearerToken', () => {
		const t = 'a'.repeat(43);
		expect(bearerToken(`Bearer ${t}`)).toBe(t);
		expect(bearerToken(`bearer ${t}`)).toBe(t);
		expect(bearerToken(null)).toBeNull();
		expect(bearerToken('Basic abc')).toBeNull();
		expect(bearerToken('Bearer short')).toBeNull();
	});
	it('isScope', () => {
		expect(isScope('lists:add')).toBe(true);
		expect(isScope('admin')).toBe(false);
	});
	it('RateLimiter slides', () => {
		const r = new RateLimiter(2, 1000);
		expect(r.take('a', 0)).toBe(true);
		expect(r.take('a', 10)).toBe(true);
		expect(r.take('a', 20)).toBe(false);
		expect(r.take('b', 20)).toBe(true);
		expect(r.take('a', 1500)).toBe(true);
	});
});
