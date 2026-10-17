/** Shared lists (LST-1): validation and ordering. Storage lives in `#lib/server/domain/lists.js`. */

export const LIST_TITLE_MAX = 40;
export const ITEM_TEXT_MAX = 120;
export const DEFAULT_LISTS = ['Grocery', 'To-Do', 'Packing'] as const;

export interface ListItem {
	id: string;
	listId: string;
	text: string;
	done: boolean;
	/** Insertion order within the list: later items get larger numbers. */
	position: number;
}

/** Trims and collapses whitespace; null when empty or longer than `max`. */
export function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== 'string') return null;
	const t = value.replace(/\s+/g, ' ').trim();
	return t.length >= 1 && t.length <= max ? t : null;
}

/** Unchecked items first, then oldest first; each group keeps the order they were added in. */
export function sortItems<T extends Pick<ListItem, 'done' | 'position'>>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position);
}

/** The position a new item takes: after every existing one. */
export function nextPosition(items: readonly Pick<ListItem, 'position'>[]): number {
	return items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
}

/** Applies a check-off to a local copy (the optimistic update, and the same rule the server uses). */
export function withDone<T extends Pick<ListItem, 'id' | 'done'>>(
	items: readonly T[],
	id: string,
	done: boolean
): T[] {
	return items.map((i) => (i.id === id ? { ...i, done } : i));
}
