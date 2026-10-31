import { describe, expect, it } from 'vitest';
import {
	MAX_FRAMES,
	addBlank,
	canAdd,
	canDelete,
	duplicate,
	frameItems,
	fromFrames,
	moveCurrent,
	newFlipbook,
	onionItems,
	removeCurrent,
	select,
	store
} from './drawing-flipbook.js';
import { emptyHistory, recordAdd } from './drawing-history.js';

const abc = () => fromFrames<string>([['a'], ['b'], ['c']], 1);

describe('flipbook', () => {
	it('starts with the board as one frame', () => {
		const h = recordAdd(emptyHistory<string>(), 'x');
		const fb = newFlipbook(['x'], h);
		expect(fb.frames).toHaveLength(1);
		expect(fb.frames[0].history).toBe(h);
		expect(fb.current).toBe(0);
	});

	it('stores the live copy in the current frame only', () => {
		const h = recordAdd(emptyHistory<string>(), 'z');
		const fb = store(abc(), ['z'], h);
		expect(frameItems(fb)).toEqual([['a'], ['z'], ['c']]);
		expect(fb.frames[1].history).toBe(h);
	});

	it('selects in range and ignores the rest', () => {
		const fb = abc();
		expect(select(fb, 2).current).toBe(2);
		expect(select(fb, 1)).toBe(fb);
		expect(select(fb, 3)).toBe(fb);
		expect(select(fb, -1)).toBe(fb);
	});

	it('adds a blank frame after the current one and selects it', () => {
		const fb = addBlank(abc())!;
		expect(frameItems(fb)).toEqual([['a'], ['b'], [], ['c']]);
		expect(fb.current).toBe(2);
	});

	it('duplicates the current frame with a fresh history', () => {
		const base = store(abc(), ['b'], recordAdd(emptyHistory<string>(), 'b'));
		const fb = duplicate(base)!;
		expect(frameItems(fb)).toEqual([['a'], ['b'], ['b'], ['c']]);
		expect(fb.current).toBe(2);
		expect(fb.frames[2].history.undo).toHaveLength(0);
		expect(fb.frames[1].history.undo).toHaveLength(1);
	});

	it('stops at the frame limit', () => {
		let fb = newFlipbook<string>([], emptyHistory());
		for (let i = 1; i < MAX_FRAMES; i++) fb = addBlank(fb)!;
		expect(fb.frames).toHaveLength(MAX_FRAMES);
		expect(canAdd(fb)).toBe(false);
		expect(addBlank(fb)).toBeNull();
		expect(duplicate(fb)).toBeNull();
	});

	it('deletes the current frame and keeps one', () => {
		const fb = removeCurrent(abc());
		expect(frameItems(fb)).toEqual([['a'], ['c']]);
		expect(fb.current).toBe(1);
		const last = removeCurrent(select(fb, 1));
		expect(last.current).toBe(0);
		const one = removeCurrent(last);
		expect(canDelete(one)).toBe(false);
		expect(removeCurrent(one)).toBe(one);
	});

	it('reorders the current frame and follows it', () => {
		const left = moveCurrent(abc(), -1);
		expect(frameItems(left)).toEqual([['b'], ['a'], ['c']]);
		expect(left.current).toBe(0);
		expect(moveCurrent(left, -1)).toBe(left);
		const right = moveCurrent(abc(), 1);
		expect(frameItems(right)).toEqual([['a'], ['c'], ['b']]);
		expect(right.current).toBe(2);
		expect(moveCurrent(right, 1)).toBe(right);
	});

	it('gives the previous frame for the onion skin', () => {
		expect(onionItems(abc())).toEqual(['a']);
		expect(onionItems(select(abc(), 0))).toBeNull();
	});

	it('round-trips through frameItems and fromFrames', () => {
		const fb = fromFrames(frameItems(abc()), 2);
		expect(frameItems(fb)).toEqual([['a'], ['b'], ['c']]);
		expect(fb.current).toBe(2);
		expect(fb.frames[0].history).toEqual(emptyHistory());
	});

	it('clamps and caps saved input', () => {
		expect(fromFrames<string>([]).frames).toHaveLength(1);
		expect(fromFrames([['a']], 9).current).toBe(0);
		expect(fromFrames([['a'], ['b']], -3).current).toBe(0);
		expect(fromFrames([['a'], ['b']], Number.NaN).current).toBe(0);
		expect(fromFrames(Array.from({ length: 40 }, () => ['x'])).frames).toHaveLength(MAX_FRAMES);
	});
});
