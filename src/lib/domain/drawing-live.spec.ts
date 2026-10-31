import { describe, expect, it } from 'vitest';
import { SAVED_MAX_ITEMS, serializeDrawing } from './drawing-save.js';
import {
	LIVE_MAX_ITEM_CHARS,
	applyEntries,
	applyEntry,
	emptyBoard,
	encodeLiveItem,
	fromSnapshot,
	parseEntry,
	parseEvent,
	sequenceEvent,
	toSnapshot,
	type LiveBoard,
	type LiveEntry,
	type LiveEvent
} from './drawing-live.js';
import type { Stroke } from './drawing.js';

const SIZE = { w: 800, h: 600 };
const stroke = (x: number): Stroke => ({
	tool: 'pen',
	color: 'draw-black',
	points: [
		{ x, y: 10, w: 4 },
		{ x: x + 5, y: 20, w: 4 }
	]
});
const add = (x: number): LiveEvent => ({ type: 'add', item: encodeLiveItem(stroke(x), SIZE) });

/** Server step that must succeed. */
function seq(board: LiveBoard, author: string, ev: LiveEvent) {
	const r = sequenceEvent(board, author, ev);
	if ('reject' in r) throw new Error(r.reject);
	return r;
}

describe('sequenceEvent', () => {
	it('numbers events in arrival order and keeps both devices strokes', () => {
		let b = emptyBoard();
		const entries: LiveEntry[] = [];
		for (const [who, x] of [
			['wall', 1],
			['ipad', 2],
			['wall', 3],
			['ipad', 4]
		] as const) {
			const r = seq(b, who, add(x));
			b = r.board;
			entries.push(r.entry);
		}
		expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		expect(b.items.map((i) => i.author)).toEqual(['wall', 'ipad', 'wall', 'ipad']);
	});

	it('undo removes only the undoers last item, even when the other drew after', () => {
		let b = emptyBoard();
		b = seq(b, 'wall', add(1)).board;
		b = seq(b, 'ipad', add(2)).board;
		b = seq(b, 'wall', add(3)).board;
		b = seq(b, 'ipad', add(4)).board;
		const r = seq(b, 'wall', { type: 'undo' });
		expect(r.entry).toMatchObject({ type: 'undo', removed: 3, seq: 5 });
		expect(r.board.items.map((i) => i.seq)).toEqual([1, 2, 4]);
		const r2 = seq(r.board, 'wall', { type: 'undo' });
		expect(r2.board.items.map((i) => i.seq)).toEqual([2, 4]);
	});

	it('rejects undo with nothing of the authors own, and an add past the cap', () => {
		const b = seq(emptyBoard(), 'wall', add(1)).board;
		expect(sequenceEvent(b, 'ipad', { type: 'undo' })).toEqual({ reject: 'nothing_to_undo' });
		const full: LiveBoard = {
			seq: SAVED_MAX_ITEMS,
			items: Array.from({ length: SAVED_MAX_ITEMS }, (_, i) => ({
				seq: i + 1,
				author: 'a',
				item: 'x'
			}))
		};
		expect(sequenceEvent(full, 'a', add(1))).toEqual({ reject: 'full' });
	});
});

describe('applyEntry', () => {
	function history() {
		let b = emptyBoard();
		const entries: LiveEntry[] = [];
		for (const [who, ev] of [
			['wall', add(1)],
			['ipad', add(2)],
			['ipad', { type: 'undo' } as LiveEvent],
			['wall', add(3)]
		] as const) {
			const r = seq(b, who, ev);
			b = r.board;
			entries.push(r.entry);
		}
		return { server: b, entries };
	}

	it('a client folding the entries matches the server board', () => {
		const { server, entries } = history();
		let c = emptyBoard();
		for (const e of entries) {
			const r = applyEntry(c, e);
			expect(r.status).toBe('applied');
			c = r.board;
		}
		expect(c).toEqual(server);
	});

	it('ignores replays and flags gaps without changing the board', () => {
		const { entries } = history();
		const one = applyEntry(emptyBoard(), entries[0]);
		expect(applyEntry(one.board, entries[0]).status).toBe('stale');
		const skip = applyEntry(one.board, entries[2]);
		expect(skip.status).toBe('gap');
		expect(skip.board).toBe(one.board);
	});

	it('applyEntries sorts out-of-order delivery and stops at a gap', () => {
		const { server, entries } = history();
		const shuffled = [entries[1], entries[3], entries[0], entries[2]];
		const r = applyEntries(emptyBoard(), shuffled);
		expect(r.gap).toBe(false);
		expect(r.board).toEqual(server);
		const gap = applyEntries(emptyBoard(), [entries[0], entries[2]]);
		expect(gap.gap).toBe(true);
		expect(gap.board.seq).toBe(1);
	});
});

describe('validation', () => {
	it('parseEvent accepts add and undo and refuses everything else', () => {
		expect(parseEvent({ type: 'undo' })).toEqual({ type: 'undo' });
		const ev = add(1);
		expect(parseEvent(ev)).toEqual(ev);
		expect(parseEvent(null)).toBeNull();
		expect(parseEvent('x')).toBeNull();
		expect(parseEvent({ type: 'clear' })).toBeNull();
		expect(parseEvent({ type: 'add', item: 5 })).toBeNull();
		expect(parseEvent({ type: 'add', item: 'not json' })).toBeNull();
		expect(parseEvent({ type: 'add', item: 'x'.repeat(LIVE_MAX_ITEM_CHARS + 1) })).toBeNull();
		const two = serializeDrawing([stroke(1), stroke(2)], SIZE);
		expect(parseEvent({ type: 'add', item: two })).toBeNull();
		const none = serializeDrawing([], SIZE);
		expect(parseEvent({ type: 'add', item: none })).toBeNull();
	});

	it('parseEntry round-trips entries and refuses malformed ones', () => {
		const a: LiveEntry = {
			seq: 1,
			author: 'w',
			type: 'add',
			item: (add(1) as { item: string }).item
		};
		const u: LiveEntry = { seq: 2, author: 'w', type: 'undo', removed: 1 };
		expect(parseEntry(JSON.parse(JSON.stringify(a)))).toEqual(a);
		expect(parseEntry(u)).toEqual(u);
		expect(parseEntry(null)).toBeNull();
		expect(parseEntry({ ...u, seq: 0 })).toBeNull();
		expect(parseEntry({ ...u, seq: 1.5 })).toBeNull();
		expect(parseEntry({ ...u, author: '' })).toBeNull();
		expect(parseEntry({ ...u, removed: 'x' })).toBeNull();
		expect(parseEntry({ ...a, item: 'bad' })).toBeNull();
		expect(parseEntry({ ...u, type: 'zap' })).toBeNull();
	});

	it('snapshots round-trip for a late joiner', () => {
		let b = emptyBoard();
		b = seq(b, 'wall', add(1)).board;
		b = seq(b, 'ipad', add(2)).board;
		const snap = JSON.parse(JSON.stringify(toSnapshot(b)));
		expect(fromSnapshot(snap)).toEqual(b);
		const next = seq(b, 'wall', add(3)).entry;
		expect(applyEntry(fromSnapshot(snap)!, next).status).toBe('applied');
	});

	it('fromSnapshot refuses malformed snapshots', () => {
		expect(fromSnapshot(null)).toBeNull();
		expect(fromSnapshot({ seq: -1, items: [] })).toBeNull();
		expect(fromSnapshot({ seq: 0, items: 'x' })).toBeNull();
		expect(fromSnapshot({ seq: 0, items: new Array(SAVED_MAX_ITEMS + 1).fill(0) })).toBeNull();
		expect(fromSnapshot({ seq: 1, items: [{ seq: 1, author: 'a', item: 'bad' }] })).toBeNull();
		expect(fromSnapshot({ seq: 1, items: [null] })).toBeNull();
	});
});
