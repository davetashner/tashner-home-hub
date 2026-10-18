/** Saved meal storage (MEAL-2). Rules live in `#lib/domain/saved-meals.js`. */
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	addedMessage,
	cleanEmoji,
	cleanIngredients,
	cleanSavedName,
	mergeIngredients,
	pickGroceryList,
	type SavedMeal
} from '#lib/domain/saved-meals.js';
import type { Db } from '../db/index.js';
import { savedMeals } from '../db/schema.js';
import { LedgerError } from './ledger.js';
import { addItem, listAll } from './lists.js';

const invalid = (msg: string) => new LedgerError('invalid', msg);

const toMeal = (r: typeof savedMeals.$inferSelect): SavedMeal => ({
	id: r.id,
	name: r.name,
	emoji: r.emoji,
	ingredients: JSON.parse(r.ingredients) as string[]
});

export function listSavedMeals(db: Db): SavedMeal[] {
	return db
		.select()
		.from(savedMeals)
		.orderBy(asc(savedMeals.name), asc(savedMeals.createdAt))
		.all()
		.map(toMeal);
}

function fields(input: Record<string, unknown>, partial: boolean) {
	const out: { name?: string; emoji?: string | null; ingredients?: string } = {};
	if (!partial || input.name !== undefined) {
		const name = cleanSavedName(input.name);
		if (!name) throw invalid('name must be 1-60 characters');
		out.name = name;
	}
	if (!partial || input.emoji !== undefined) {
		const emoji = cleanEmoji(input.emoji);
		if (emoji === undefined) throw invalid('emoji must be a short emoji');
		out.emoji = emoji;
	}
	if (!partial || input.ingredients !== undefined) {
		const ing = cleanIngredients(input.ingredients);
		if (ing === null) throw invalid('ingredients must be up to 40 short items');
		out.ingredients = JSON.stringify(ing);
	}
	return out;
}

export function createSavedMeal(db: Db, input: Record<string, unknown>): SavedMeal {
	const row = db
		.insert(savedMeals)
		.values({ id: randomUUID(), ...fields(input, false) } as typeof savedMeals.$inferInsert)
		.returning()
		.get();
	return toMeal(row);
}

export function updateSavedMeal(db: Db, id: string, input: Record<string, unknown>): SavedMeal {
	const set = fields(input, true);
	const row =
		Object.keys(set).length === 0
			? db.select().from(savedMeals).where(eq(savedMeals.id, id)).get()
			: db.update(savedMeals).set(set).where(eq(savedMeals.id, id)).returning().get();
	if (!row) throw new LedgerError('not_found', 'Saved meal not found');
	return toMeal(row);
}

/** Deleting one that is already gone succeeds (a replayed or double-tapped delete). */
export function deleteSavedMeal(db: Db, id: string): { id: string } {
	db.delete(savedMeals).where(eq(savedMeals.id, id)).run();
	return { id };
}

export interface AddResult {
	listId: string;
	listTitle: string;
	added: number;
	skipped: number;
	message: string;
}

/** Adds a meal's ingredients to `listId`, else Grocery, else the first list; skips open duplicates. */
export function addIngredientsToList(db: Db, id: string, listId?: unknown): AddResult {
	const row = db.select().from(savedMeals).where(eq(savedMeals.id, id)).get();
	if (!row) throw new LedgerError('not_found', 'Saved meal not found');
	const all = listAll(db);
	const list =
		listId === undefined || listId === null
			? pickGroceryList(all)
			: (all.find((l) => l.id === listId) ?? null);
	if (!list) throw new LedgerError('not_found', 'List not found');
	const { toAdd, skipped } = mergeIngredients(list.items, toMeal(row).ingredients);
	for (const text of toAdd) addItem(db, list.id, text);
	return {
		listId: list.id,
		listTitle: list.title,
		added: toAdd.length,
		skipped: skipped.length,
		message: addedMessage(toAdd.length, skipped.length, list.title)
	};
}
