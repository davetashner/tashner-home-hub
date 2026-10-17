import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { deleteMeal, listRange, listWeek, setMeal } from './meals.js';

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

describe('meal plan storage', () => {
	it('sets, replaces and lists a week Monday to Sunday', () => {
		setMeal(db, { date: '2026-10-12', meal: 'dinner', title: ' Tacos ' });
		setMeal(db, { date: '2026-10-12', meal: 'dinner', title: 'Pasta' });
		setMeal(db, { date: '2026-10-18', meal: 'lunch', title: 'Soup' });
		setMeal(db, { date: '2026-10-19', meal: 'lunch', title: 'Next week' });
		const week = listWeek(db, '2026-10-15');
		expect(week.map((e) => e.title).sort()).toEqual(['Pasta', 'Soup']);
		expect(listRange(db, '2026-10-19', '2026-10-19')).toHaveLength(1);
	});
	it('deletes an entry and 404s when nothing is there', () => {
		setMeal(db, { date: '2026-10-12', meal: 'snack', title: 'Apples' });
		deleteMeal(db, { date: '2026-10-12', meal: 'snack' });
		expect(listWeek(db, '2026-10-12')).toEqual([]);
		expect(code(() => deleteMeal(db, { date: '2026-10-12', meal: 'snack' }))).toBe('not_found');
	});
	it('rejects bad input', () => {
		expect(code(() => setMeal(db, { date: 'x', meal: 'dinner', title: 'a' }))).toBe('invalid');
		expect(code(() => setMeal(db, { date: '2026-10-12', meal: 'brunch', title: 'a' }))).toBe(
			'invalid'
		);
		expect(code(() => setMeal(db, { date: '2026-10-12', meal: 'dinner', title: ' ' }))).toBe(
			'invalid'
		);
		expect(code(() => listWeek(db, 'nope'))).toBe('invalid');
		expect(code(() => listRange(db, 'a', 'b'))).toBe('invalid');
	});
});
