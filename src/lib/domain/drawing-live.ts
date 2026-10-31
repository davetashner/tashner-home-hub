/**
 * Live shared drawing board (hub-cn7.29): the pure ordering and merge rules. The server gives
 * every accepted event the next sequence number of its session and broadcasts the resulting
 * entry; clients (and the server itself) fold entries into a board with `applyEntry`.
 *
 * Items travel in the saved-drawing wire format (`drawing-save.ts`): an item is a one-item
 * drawing JSON string, so it carries the canvas size it was drawn on and is refitted by
 * `loadDrawing` on the receiving device. Each item records its author, and an undo removes only
 * that author's most recent item, so two people drawing at once never undo each other.
 */
import { SAVED_MAX_ITEMS, isSavedDrawing, serializeDrawing, type Size } from './drawing-save.js';
import type { DrawItem } from './drawing.js';

/** Longest accepted item string: one stroke at the saved-drawing point cap fits well below this. */
export const LIVE_MAX_ITEM_CHARS = 120_000;
export const LIVE_MAX_AUTHOR = 64;

/** What a device sends. */
export type LiveEvent = { type: 'add'; item: string } | { type: 'undo' };

/** What the server broadcasts: an event stamped with its place in the session's order. */
export type LiveEntry =
	| { seq: number; author: string; type: 'add'; item: string }
	/** `removed` is the seq of the add entry taken off the board, so every client agrees. */
	| { seq: number; author: string; type: 'undo'; removed: number };

export interface LiveItem {
	/** Seq of the add entry that created it. */
	seq: number;
	author: string;
	item: string;
}

export interface LiveBoard {
	/** Seq of the last entry applied (0 for a new board). */
	seq: number;
	items: LiveItem[];
}

export const emptyBoard = (): LiveBoard => ({ seq: 0, items: [] });

/** Wire form of one board item, for an `add` event. */
export const encodeLiveItem = (item: DrawItem, size: Size, dpr = 1): string =>
	serializeDrawing([item], size, dpr);

/** True for a well-formed one-item drawing within the size limit. */
function isOneItem(json: unknown): json is string {
	if (typeof json !== 'string' || json.length > LIVE_MAX_ITEM_CHARS) return false;
	if (!isSavedDrawing(json)) return false;
	return (JSON.parse(json) as { items: unknown[] }).items.length === 1;
}

export const isAuthor = (v: unknown): v is string =>
	typeof v === 'string' && v.length > 0 && v.length <= LIVE_MAX_AUTHOR;

/** The event a device sent, or null when it is not a valid one. Never trust a client. */
export function parseEvent(raw: unknown): LiveEvent | null {
	if (!raw || typeof raw !== 'object') return null;
	const e = raw as Record<string, unknown>;
	if (e.type === 'undo') return { type: 'undo' };
	if (e.type === 'add' && isOneItem(e.item)) return { type: 'add', item: e.item };
	return null;
}

/** Why an event produced no entry. */
export type RejectReason = 'full' | 'nothing_to_undo';

/**
 * Server side: stamp `event` from `author` with the next seq and fold it into the board.
 * An add past the item cap, or an undo when the author has nothing on the board, is rejected.
 */
export function sequenceEvent(
	board: LiveBoard,
	author: string,
	event: LiveEvent
): { board: LiveBoard; entry: LiveEntry } | { reject: RejectReason } {
	const seq = board.seq + 1;
	if (event.type === 'add') {
		if (board.items.length >= SAVED_MAX_ITEMS) return { reject: 'full' };
		const entry: LiveEntry = { seq, author, type: 'add', item: event.item };
		return { board: applyKnown(board, entry), entry };
	}
	const mine = lastBy(board.items, author);
	if (!mine) return { reject: 'nothing_to_undo' };
	const entry: LiveEntry = { seq, author, type: 'undo', removed: mine.seq };
	return { board: applyKnown(board, entry), entry };
}

function lastBy(items: readonly LiveItem[], author: string): LiveItem | undefined {
	for (let i = items.length - 1; i >= 0; i--) if (items[i].author === author) return items[i];
	return undefined;
}

function applyKnown(board: LiveBoard, entry: LiveEntry): LiveBoard {
	if (entry.type === 'add')
		return {
			seq: entry.seq,
			items: [...board.items, { seq: entry.seq, author: entry.author, item: entry.item }]
		};
	return { seq: entry.seq, items: board.items.filter((i) => i.seq !== entry.removed) };
}

export type ApplyStatus = 'applied' | 'stale' | 'gap';

/**
 * Client side: fold a broadcast entry in. A replayed entry (seq at or below the board's) is
 * `stale` and ignored; one that skips ahead is a `gap`: the board is unchanged and the caller
 * should refetch the snapshot. Entries therefore converge on the same board on every device
 * whatever order the network delivered them in, as long as gaps trigger a resync.
 */
export function applyEntry(
	board: LiveBoard,
	entry: LiveEntry
): { board: LiveBoard; status: ApplyStatus } {
	if (entry.seq <= board.seq) return { board, status: 'stale' };
	if (entry.seq !== board.seq + 1) return { board, status: 'gap' };
	return { board: applyKnown(board, entry), status: 'applied' };
}

/** Folds a batch, sorting by seq first; stops at a gap and reports it. */
export function applyEntries(
	board: LiveBoard,
	entries: readonly LiveEntry[]
): { board: LiveBoard; gap: boolean } {
	let cur = board;
	for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
		const r = applyEntry(cur, e);
		if (r.status === 'gap') return { board: cur, gap: true };
		cur = r.board;
	}
	return { board: cur, gap: false };
}

/** An entry from the wire (SSE data), or null when malformed. */
export function parseEntry(raw: unknown): LiveEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const e = raw as Record<string, unknown>;
	const seq = e.seq;
	if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || !isAuthor(e.author))
		return null;
	if (e.type === 'add' && isOneItem(e.item))
		return { seq, author: e.author, type: 'add', item: e.item };
	if (
		e.type === 'undo' &&
		typeof e.removed === 'number' &&
		Number.isInteger(e.removed) &&
		e.removed >= 1
	)
		return { seq, author: e.author, type: 'undo', removed: e.removed };
	return null;
}

/** The board as a joiner needs it: restore with `fromSnapshot`. */
export const toSnapshot = (board: LiveBoard): LiveBoard => ({
	seq: board.seq,
	items: board.items.map((i) => ({ ...i }))
});

/** A board from a fetched snapshot, or null when it is malformed. */
export function fromSnapshot(raw: unknown): LiveBoard | null {
	if (!raw || typeof raw !== 'object') return null;
	const s = raw as Record<string, unknown>;
	if (typeof s.seq !== 'number' || !Number.isInteger(s.seq) || s.seq < 0) return null;
	if (!Array.isArray(s.items) || s.items.length > SAVED_MAX_ITEMS) return null;
	const items: LiveItem[] = [];
	for (const it of s.items as Record<string, unknown>[]) {
		if (!it || typeof it.seq !== 'number' || !isAuthor(it.author) || !isOneItem(it.item))
			return null;
		items.push({ seq: it.seq, author: it.author, item: it.item });
	}
	return { seq: s.seq, items };
}
