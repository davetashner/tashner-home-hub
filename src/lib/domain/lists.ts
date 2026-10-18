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

/** Who a list is for. */
export interface ListOwner {
	id: string;
	name: string;
}

/** The owner filter: everyone, only the House lists, or one adult's id. */
export type OwnerFilter = 'all' | 'house' | (string & {});

export interface OwnedList {
	id: string;
	/** The adult this list is for; null is House. */
	ownerId: string | null;
	items: readonly Pick<ListItem, 'done'>[];
}

export interface OwnerGroup<T> {
	/** The adult's member id; null for House. */
	ownerId: string | null;
	label: string;
	lists: T[];
	/** Unchecked items across the group's lists. */
	left: number;
}

export const HOUSE_LABEL = 'House';

/** Unchecked items on a list ("N left"). */
export function itemsLeft(list: Pick<OwnedList, 'items'>): number {
	return list.items.reduce((n, i) => n + (i.done ? 0 : 1), 0);
}

/** An owner that is no longer a known adult counts as House, so a list never vanishes. */
export function effectiveOwner(list: Pick<OwnedList, 'ownerId'>, adults: readonly ListOwner[]) {
	return list.ownerId !== null && adults.some((a) => a.id === list.ownerId) ? list.ownerId : null;
}

/** Keeps the lists the filter selects, in their original order. */
export function filterByOwner<T extends Pick<OwnedList, 'ownerId'>>(
	lists: readonly T[],
	filter: OwnerFilter,
	adults: readonly ListOwner[]
): T[] {
	if (filter === 'all') return [...lists];
	const want = filter === 'house' ? null : filter;
	return lists.filter((l) => effectiveOwner(l, adults) === want);
}

/** Groups lists by owner: each adult in the given order, then House. Empty groups are omitted. */
export function groupByOwner<T extends OwnedList>(
	lists: readonly T[],
	adults: readonly ListOwner[]
): OwnerGroup<T>[] {
	const slots: { ownerId: string | null; label: string }[] = [
		...adults.map((a) => ({ ownerId: a.id as string | null, label: a.name })),
		{ ownerId: null, label: HOUSE_LABEL }
	];
	return slots
		.map((slot) => {
			const mine = lists.filter((l) => effectiveOwner(l, adults) === slot.ownerId);
			return { ...slot, lists: mine, left: mine.reduce((n, l) => n + itemsLeft(l), 0) };
		})
		.filter((g) => g.lists.length > 0);
}

/** Validates a reassignment body value: a member id string, or null/"house" for House. */
export function parseOwnerId(value: unknown): string | null | undefined {
	if (value === null || value === 'house') return null;
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
