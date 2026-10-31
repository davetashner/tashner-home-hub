import { describe, expect, it } from 'vitest';
import {
	HISTORY_LIMIT,
	canRedo,
	canUndo,
	clearAll,
	emptyHistory,
	freshBoard,
	isFreshBoard,
	record,
	recordAdd,
	redoStep,
	undoStep,
	type Board
} from './drawing-history.js';

const board = (over: Partial<Board<string>> = {}): Board<string> => ({
	...freshBoard<string>(),
	...over
});

describe('fresh board', () => {
	it('is fresh only when nothing differs', () => {
		expect(isFreshBoard(freshBoard())).toBe(true);
		expect(isFreshBoard(board({ items: ['a'] }))).toBe(false);
		expect(isFreshBoard(board({ page: 'cat' }))).toBe(false);
		expect(isFreshBoard(board({ photoId: 'p1' }))).toBe(false);
		expect(isFreshBoard(board({ bg: 'red' }))).toBe(false);
		expect(isFreshBoard(board({ layers: { drawing: false, picture: true } }))).toBe(true);
	});

	it('clearAll resets everything, layers included', () => {
		expect(clearAll()).toEqual(freshBoard());
	});
});

describe('add entries', () => {
	it('undo drops the last items and keeps page, photo and background', () => {
		const h = recordAdd(emptyHistory<string>(), 'a');
		const b = board({ items: ['a'], bg: 'blue' });
		const s = undoStep(h, b)!;
		expect(s.board).toEqual(board({ items: [], bg: 'blue' }));
		expect(canUndo(s.history)).toBe(false);
		expect(canRedo(s.history)).toBe(true);
	});

	it('redo puts them back at the end', () => {
		const h = recordAdd(emptyHistory<string>(), 'b');
		const undone = undoStep(h, board({ items: ['a', 'b'] }))!;
		const redone = redoStep(undone.history, undone.board)!;
		expect(redone.board.items).toEqual(['a', 'b']);
		expect(canUndo(redone.history)).toBe(true);
		expect(canRedo(redone.history)).toBe(false);
	});

	it('records several items as one step', () => {
		const h = recordAdd(emptyHistory<string>(), 'x', 'y');
		expect(undoStep(h, board({ items: ['w', 'x', 'y'] }))!.board.items).toEqual(['w']);
	});
});

describe('replace entries (Clear all)', () => {
	const before = board({ items: ['a', 'b'], page: 'cat', photoId: null, bg: 'blue' });
	const hidden = { ...before, layers: { drawing: false, picture: true } };
	const h = record(emptyHistory<string>(), { type: 'replace', before: hidden, after: clearAll() });

	it('undo restores the exact previous board, layer visibility included', () => {
		const s = undoStep(h, clearAll<string>())!;
		expect(s.board).toBe(hidden);
	});

	it('redo clears again', () => {
		const undone = undoStep(h, clearAll<string>())!;
		expect(redoStep(undone.history, undone.board)!.board).toEqual(freshBoard());
	});

	it('plain undo walks back through a clear then the strokes before it', () => {
		const h2 = recordAdd(h, 'c');
		const first = undoStep(h2, board({ items: ['c'] }))!;
		expect(first.board.items).toEqual([]);
		const second = undoStep(first.history, first.board)!;
		expect(second.board).toBe(hidden);
	});
});

describe('stack rules', () => {
	it('returns null when there is nothing to undo or redo', () => {
		expect(undoStep(emptyHistory(), freshBoard())).toBeNull();
		expect(redoStep(emptyHistory(), freshBoard())).toBeNull();
	});

	it('a new action empties the redo stack', () => {
		const h = recordAdd(emptyHistory<string>(), 'a');
		const undone = undoStep(h, board({ items: ['a'] }))!;
		expect(canRedo(undone.history)).toBe(true);
		expect(canRedo(recordAdd(undone.history, 'z'))).toBe(false);
	});

	it('keeps only the newest HISTORY_LIMIT entries', () => {
		let h = emptyHistory<number>();
		for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordAdd(h, i);
		expect(h.undo).toHaveLength(HISTORY_LIMIT);
		expect(h.undo[0]).toEqual({ type: 'add', items: [5] });
	});

	it('redo past the limit stays capped', () => {
		let h = emptyHistory<number>();
		for (let i = 0; i < HISTORY_LIMIT; i++) h = recordAdd(h, i);
		const u = undoStep(h, { ...freshBoard<number>(), items: [0] })!;
		const r = redoStep(u.history, u.board)!;
		expect(r.history.undo).toHaveLength(HISTORY_LIMIT);
	});
});
