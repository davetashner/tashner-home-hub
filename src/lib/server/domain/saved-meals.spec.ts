import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { addItem, listAll } from './lists.js';
import {
	addIngredientsToList,
	createSavedMeal,
	deleteSavedMeal,
	listSavedMeals,
	updateSavedMeal
} from './saved-meals.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('saved meal storage', () => {
	it('creates, lists, updates and deletes', () => {
		const m = createSavedMeal(db, {
			name: ' Tacos ',
			emoji: '🌮',
			ingredients: ['Tortillas', 'beef']
		});
		expect(m).toMatchObject({ name: 'Tacos', emoji: '🌮', ingredients: ['Tortillas', 'beef'] });
		createSavedMeal(db, { name: 'Soup' });
		expect(listSavedMeals(db).map((x) => x.name)).toEqual(['Soup', 'Tacos']);
		expect(updateSavedMeal(db, m.id, { ingredients: 'a\nb' }).ingredients).toEqual(['a', 'b']);
		expect(updateSavedMeal(db, m.id, {}).name).toBe('Tacos');
		expect(updateSavedMeal(db, m.id, { emoji: '' }).emoji).toBeNull();
		deleteSavedMeal(db, m.id);
		deleteSavedMeal(db, m.id);
		expect(listSavedMeals(db)).toHaveLength(1);
	});
	it('validates', () => {
		expect(code(() => createSavedMeal(db, { name: '' }))).toBe('invalid');
		expect(code(() => createSavedMeal(db, { name: 'x', emoji: 'abcdefghijk' }))).toBe('invalid');
		expect(code(() => createSavedMeal(db, { name: 'x', ingredients: 7 }))).toBe('invalid');
		expect(code(() => updateSavedMeal(db, 'nope', { name: 'y' }))).toBe('not_found');
		expect(code(() => updateSavedMeal(db, 'nope', {}))).toBe('not_found');
	});
});

describe('adding ingredients to a list', () => {
	it('adds to Grocery, skipping open duplicates, and reports it', () => {
		const grocery = listAll(db).find((l) => l.title === 'Grocery')!;
		addItem(db, grocery.id, 'MILK');
		const done = addItem(db, grocery.id, 'eggs');
		db.$client.prepare('UPDATE list_items SET done = 1 WHERE id = ?').run(done.id);
		const m = createSavedMeal(db, { name: 'Pancakes', ingredients: ['milk', 'eggs', 'flour'] });
		const r = addIngredientsToList(db, m.id);
		expect(r).toMatchObject({
			listTitle: 'Grocery',
			added: 2,
			skipped: 1,
			message: 'Added 2, 1 already on the list'
		});
		const texts = listAll(db)
			.find((l) => l.id === grocery.id)!
			.items.map((i) => i.text);
		expect(texts).toEqual(expect.arrayContaining(['MILK', 'eggs', 'flour']));
		expect(addIngredientsToList(db, m.id).added).toBe(0);
	});
	it('uses an explicit list, and errors on unknown meal or list', () => {
		const todo = listAll(db).find((l) => l.title === 'To-Do')!;
		const m = createSavedMeal(db, { name: 'Salad', ingredients: ['lettuce'] });
		expect(addIngredientsToList(db, m.id, todo.id)).toMatchObject({ listTitle: 'To-Do', added: 1 });
		expect(code(() => addIngredientsToList(db, m.id, 'nope'))).toBe('not_found');
		expect(code(() => addIngredientsToList(db, 'nope'))).toBe('not_found');
	});
	it('falls back to the first list when none is named Grocery', () => {
		listAll(db);
		db.$client.prepare("UPDATE lists SET title = 'Errands' WHERE title = 'Grocery'").run();
		const m = createSavedMeal(db, { name: 'Salad', ingredients: ['lettuce'] });
		expect(addIngredientsToList(db, m.id).listTitle).toBe('Errands');
	});
	it('errors when there are no lists at all', () => {
		listAll(db);
		db.$client.prepare('DELETE FROM lists').run();
		const m = createSavedMeal(db, { name: 'Salad', ingredients: ['lettuce'] });
		expect(code(() => addIngredientsToList(db, m.id))).toBe('not_found');
	});
});
