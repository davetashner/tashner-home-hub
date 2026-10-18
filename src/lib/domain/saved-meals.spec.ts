import { describe, expect, it } from 'vitest';
import {
	addedMessage,
	cleanEmoji,
	cleanIngredients,
	cleanSavedName,
	ingredientKey,
	MAX_INGREDIENTS,
	mergeIngredients,
	pickGroceryList
} from './saved-meals.js';

describe('cleanIngredients', () => {
	it('trims, drops blanks and case-insensitive repeats, keeping the first spelling', () => {
		expect(cleanIngredients([' Milk ', 'milk', '', 'Eggs  ', 'EGGS'])).toEqual(['Milk', 'Eggs']);
	});
	it('splits a string on lines and commas', () => {
		expect(cleanIngredients('rice\nbeans, salsa\n')).toEqual(['rice', 'beans', 'salsa']);
	});
	it('treats missing as empty and rejects bad shapes', () => {
		expect(cleanIngredients(undefined)).toEqual([]);
		expect(cleanIngredients(null)).toEqual([]);
		expect(cleanIngredients(5)).toBeNull();
		expect(cleanIngredients(['ok', 3])).toBeNull();
		expect(cleanIngredients(['x'.repeat(121)])).toBeNull();
		expect(
			cleanIngredients(Array.from({ length: MAX_INGREDIENTS + 1 }, (_, i) => `i${i}`))
		).toBeNull();
	});
});

describe('names and emoji', () => {
	it('cleans names', () => {
		expect(cleanSavedName('  Taco   night ')).toBe('Taco night');
		expect(cleanSavedName('')).toBeNull();
		expect(cleanSavedName('x'.repeat(61))).toBeNull();
	});
	it('cleans emoji', () => {
		expect(cleanEmoji(undefined)).toBeNull();
		expect(cleanEmoji(' ')).toBeNull();
		expect(cleanEmoji(' 🌮 ')).toBe('🌮');
		expect(cleanEmoji('abcdefghijk')).toBeUndefined();
		expect(cleanEmoji(4)).toBeUndefined();
	});
});

describe('mergeIngredients', () => {
	it('skips open items case-insensitively but re-adds checked-off ones', () => {
		const existing = [
			{ text: 'MILK', done: false },
			{ text: 'Eggs', done: true }
		];
		expect(mergeIngredients(existing, ['milk', 'eggs', ' Flour '])).toEqual({
			toAdd: ['eggs', ' Flour '],
			skipped: ['milk']
		});
	});
	it('does not add the same ingredient twice in one go', () => {
		expect(mergeIngredients([], ['a', 'A']).toAdd).toEqual(['a']);
		expect(mergeIngredients([], ['a', 'A']).skipped).toEqual(['A']);
	});
	it('normalizes keys', () => {
		expect(ingredientKey('  Sour   Cream ')).toBe('sour cream');
	});
});

describe('pickGroceryList', () => {
	const lists = [
		{ id: '1', title: 'To-Do' },
		{ id: '2', title: 'grocery' }
	];
	it('prefers the Grocery list, then the first, then none', () => {
		expect(pickGroceryList(lists)?.id).toBe('2');
		expect(pickGroceryList(lists.slice(0, 1))?.id).toBe('1');
		expect(pickGroceryList([])).toBeNull();
	});
});

describe('addedMessage', () => {
	it('words every case', () => {
		expect(addedMessage(5, 2, 'Grocery')).toBe('Added 5, 2 already on the list');
		expect(addedMessage(3, 0)).toBe('Added 3');
		expect(addedMessage(0, 4)).toBe('All 4 already on the list');
		expect(addedMessage(0, 0)).toBe('No ingredients to add');
		expect(addedMessage(2, 1, 'To-Do')).toBe('Added 2 to To-Do, 1 already on the list');
	});
});
