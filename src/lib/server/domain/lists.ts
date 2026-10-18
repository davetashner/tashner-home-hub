/** Shared list storage (LST-1). Validation and ordering live in `#lib/domain/lists.js`. */
import { asc, eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	cleanText,
	DEFAULT_LISTS,
	ITEM_TEXT_MAX,
	LIST_TITLE_MAX,
	nextPosition,
	sortItems,
	type ListItem
} from '#lib/domain/lists.js';
import type { Db } from '../db/index.js';
import { listItems, lists, settings } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export interface SharedList {
	id: string;
	title: string;
	items: ListItem[];
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

/** Settings key set once the default lists were seeded (or lists already existed). */
export const LISTS_SEEDED_KEY = 'lists.seeded';

/** Every list with its items in display order; seeds Grocery, To-Do and Packing once, ever. */
export function listAll(db: Db): SharedList[] {
	return db.transaction((tx) => {
		const seeded = tx.select().from(settings).where(eq(settings.key, LISTS_SEEDED_KEY)).get();
		if (!seeded) {
			// An install that already has lists counts as seeded; only a fresh one gets the defaults.
			if (tx.select().from(lists).limit(1).all().length === 0)
				DEFAULT_LISTS.forEach((title, i) =>
					tx
						.insert(lists)
						.values({ id: randomUUID(), title, createdAt: Date.now() + i })
						.run()
				);
			tx.insert(settings)
				.values({ key: LISTS_SEEDED_KEY, value: 'true' })
				.onConflictDoNothing()
				.run();
		}
		const items = tx.select().from(listItems).all();
		return tx
			.select()
			.from(lists)
			.orderBy(asc(lists.createdAt), asc(lists.title))
			.all()
			.map((l) => ({
				id: l.id,
				title: l.title,
				items: sortItems(items.filter((i) => i.listId === l.id))
			}));
	});
}

export function createList(db: Db, title: unknown): { id: string; title: string } {
	const t = cleanText(title, LIST_TITLE_MAX);
	if (!t) throw invalid(`name must be 1-${LIST_TITLE_MAX} characters`);
	return db.insert(lists).values({ id: randomUUID(), title: t }).returning().get();
}

export function deleteList(db: Db, id: string): { id: string } {
	const gone = db.delete(lists).where(eq(lists.id, id)).returning().all();
	if (gone.length === 0) throw new LedgerError('not_found', 'List not found');
	return { id };
}

export function addItem(db: Db, listId: string, text: unknown): ListItem {
	const t = cleanText(text, ITEM_TEXT_MAX);
	if (!t) throw invalid(`text must be 1-${ITEM_TEXT_MAX} characters`);
	return db.transaction((tx) => {
		if (!tx.select().from(lists).where(eq(lists.id, listId)).get())
			throw new LedgerError('not_found', 'List not found');
		const existing = tx.select().from(listItems).where(eq(listItems.listId, listId)).all();
		return tx
			.insert(listItems)
			.values({ id: randomUUID(), listId, text: t, position: nextPosition(existing) })
			.returning()
			.get();
	});
}

/** Sets (not toggles) the checked state, so a replayed offline write is harmless. */
export function setDone(db: Db, id: string, done: unknown): ListItem {
	if (typeof done !== 'boolean') throw invalid('done must be true or false');
	const row = db.update(listItems).set({ done }).where(eq(listItems.id, id)).returning().get();
	if (!row) throw new LedgerError('not_found', 'Item not found');
	return row;
}

/** Deleting an item that is already gone succeeds: the other device got there first. */
export function deleteItem(db: Db, id: string): { id: string } {
	db.delete(listItems).where(eq(listItems.id, id)).run();
	return { id };
}

export function clearChecked(db: Db, listId: string): { removed: number } {
	const gone = db
		.delete(listItems)
		.where(and(eq(listItems.listId, listId), eq(listItems.done, true)))
		.returning()
		.all();
	return { removed: gone.length };
}
