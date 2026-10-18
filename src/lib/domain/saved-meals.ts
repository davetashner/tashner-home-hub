/** Saved meals (MEAL-2): validation and the ingredient merge against a shopping list. */
import { cleanText, ITEM_TEXT_MAX } from './lists.js';

export const SAVED_NAME_MAX = 60;
export const EMOJI_MAX = 8;
export const MAX_INGREDIENTS = 40;
export const GROCERY_TITLE = 'Grocery';

export interface SavedMeal {
	id: string;
	name: string;
	emoji: string | null;
	ingredients: string[];
}

/** Lower-cased, whitespace-collapsed key used to compare ingredients. */
export const ingredientKey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Ingredients from an array or a newline/comma separated string: trimmed, empties and
 * case-insensitive repeats dropped (first spelling wins). Null when malformed or too many/long.
 */
export function cleanIngredients(raw: unknown): string[] | null {
	const parts = Array.isArray(raw)
		? raw
		: typeof raw === 'string'
			? raw.split(/[\n,]/)
			: raw === undefined || raw === null
				? []
				: null;
	if (parts === null) return null;
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of parts) {
		if (typeof p !== 'string') return null;
		if (p.trim() === '') continue;
		const t = cleanText(p, ITEM_TEXT_MAX);
		if (t === null) return null;
		const k = ingredientKey(t);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(t);
	}
	return out.length > MAX_INGREDIENTS ? null : out;
}

/** An emoji field: trimmed, or null when blank. Undefined when too long to be one. */
export function cleanEmoji(raw: unknown): string | null | undefined {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') return undefined;
	const t = raw.trim();
	if (t === '') return null;
	return [...t].length <= EMOJI_MAX ? t : undefined;
}

export const cleanSavedName = (v: unknown) => cleanText(v, SAVED_NAME_MAX);

/**
 * Splits a meal's ingredients into those to add and those already on the list. Only items not
 * checked off count as "already there": a bought one needs buying again.
 */
export function mergeIngredients(
	existing: readonly { text: string; done: boolean }[],
	ingredients: readonly string[]
): { toAdd: string[]; skipped: string[] } {
	const open = new Set(existing.filter((i) => !i.done).map((i) => ingredientKey(i.text)));
	const toAdd: string[] = [];
	const skipped: string[] = [];
	for (const ing of ingredients) {
		const k = ingredientKey(ing);
		if (open.has(k)) skipped.push(ing);
		else {
			open.add(k);
			toAdd.push(ing);
		}
	}
	return { toAdd, skipped };
}

/** The list ingredients go to: the one named Grocery (any case), else the first list. */
export function pickGroceryList<T extends { id: string; title: string }>(
	lists: readonly T[]
): T | null {
	const key = ingredientKey(GROCERY_TITLE);
	return lists.find((l) => ingredientKey(l.title) === key) ?? lists[0] ?? null;
}

/** The toast after adding: "Added 5, 2 already on the list". */
export function addedMessage(added: number, skipped: number, listTitle?: string): string {
	if (added === 0 && skipped === 0) return 'No ingredients to add';
	const where =
		listTitle && ingredientKey(listTitle) !== ingredientKey(GROCERY_TITLE)
			? ` to ${listTitle}`
			: '';
	if (skipped === 0) return `Added ${added}${where}`;
	if (added === 0) return `All ${skipped} already on the list`;
	return `Added ${added}${where}, ${skipped} already on the list`;
}
