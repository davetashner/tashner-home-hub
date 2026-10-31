/**
 * Drawing history (hub-cn7.12): one undo/redo stack for the whole board, so Clear all can be
 * undone and every undone action can be redone. Pure and immutable: the sheet owns the canvases,
 * keeps a `History` in a variable and swaps it for the one these functions return.
 *
 * A `Board` is everything that makes a drawing: the items (strokes, shapes, fills), the coloring
 * page, the photo, the background color and which layers show.
 *
 * Two kinds of entry:
 *  - `add`: items were appended (a stroke, a shape, a fill). Undo drops them from the END of the
 *    board's items, redo puts them back. It leaves page, photo, background and layers alone, so
 *    undoing a stroke never reverts a background picked since.
 *  - `replace`: the board changed in ways an add cannot describe (Clear all today; mirror, text or
 *    flipbook later). It holds the whole board before and after, and undo/redo swap them in.
 *
 * Adding a new undoable action: call `record(history, { type: 'replace', before, after })` with
 * the board before and after, or `recordAdd` when it only appends items. Any record empties the
 * redo stack. When a change cannot be undone (opening another saved drawing, picking a coloring
 * page), call `emptyHistory()` so stale entries never apply to a different board.
 */
import { ALL_VISIBLE, type LayerVisibility } from './drawing-layers.js';

export interface Board<I = unknown> {
	items: readonly I[];
	page: string | null;
	photoId: string | null;
	bg: string | null;
	layers: LayerVisibility;
}

export type Entry<I = unknown> =
	{ type: 'add'; items: readonly I[] } | { type: 'replace'; before: Board<I>; after: Board<I> };

export interface History<I = unknown> {
	undo: readonly Entry<I>[];
	redo: readonly Entry<I>[];
}

/** Entries kept per stack; the oldest fall off. */
export const HISTORY_LIMIT = 100;

export const emptyHistory = <I = unknown>(): History<I> => ({ undo: [], redo: [] });

/** A fresh board: no ink, no picture, paper background, every layer showing. */
export const freshBoard = <I = unknown>(): Board<I> => ({
	items: [],
	page: null,
	photoId: null,
	bg: null,
	layers: ALL_VISIBLE
});

/** True when nothing differs from a fresh board (layer visibility alone does not count). */
export const isFreshBoard = (b: Board): boolean =>
	b.items.length === 0 && b.page === null && b.photoId === null && b.bg === null;

/** The board after Clear all. */
export const clearAll = <I>(): Board<I> => freshBoard<I>();

export const canUndo = (h: History): boolean => h.undo.length > 0;
export const canRedo = (h: History): boolean => h.redo.length > 0;

const cap = <I>(entries: readonly Entry<I>[]): readonly Entry<I>[] =>
	entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries;

/** Record a new action. A new action always empties the redo stack. */
export const record = <I>(h: History<I>, entry: Entry<I>): History<I> => ({
	undo: cap([...h.undo, entry]),
	redo: []
});

/** Record items appended to the board (one stroke, shape or fill). */
export const recordAdd = <I>(h: History<I>, ...items: I[]): History<I> =>
	record(h, { type: 'add', items });

const apply = <I>(board: Board<I>, entry: Entry<I>, direction: 'undo' | 'redo'): Board<I> => {
	if (entry.type === 'replace') return direction === 'undo' ? entry.before : entry.after;
	return direction === 'undo'
		? { ...board, items: board.items.slice(0, board.items.length - entry.items.length) }
		: { ...board, items: [...board.items, ...entry.items] };
};

export interface Step<I> {
	history: History<I>;
	board: Board<I>;
	entry: Entry<I>;
}

/** Undo the latest action, or null when there is nothing to undo. */
export const undoStep = <I>(h: History<I>, board: Board<I>): Step<I> | null => {
	const entry = h.undo[h.undo.length - 1];
	if (!entry) return null;
	return {
		history: { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] },
		board: apply(board, entry, 'undo'),
		entry
	};
};

/** Redo the latest undone action, or null when there is nothing to redo. */
export const redoStep = <I>(h: History<I>, board: Board<I>): Step<I> | null => {
	const entry = h.redo[h.redo.length - 1];
	if (!entry) return null;
	return {
		history: { undo: cap([...h.undo, entry]), redo: h.redo.slice(0, -1) },
		board: apply(board, entry, 'redo'),
		entry
	};
};
