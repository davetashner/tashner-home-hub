/**
 * Flipbook frames (hub-cn7.25): an ordered list of frames, each with its own items and its own
 * undo history (see drawing-history.ts). Pure and immutable.
 *
 * The sheet keeps the CURRENT frame's items and history as its live working copy (so the whole
 * board code is unchanged) and calls `store` to write them back into the list before it switches
 * frame, adds, duplicates, deletes or reorders. Page, photo, background and layers are shared by
 * every frame; they are not part of a frame.
 *
 * Serializing (hub-cn7.26): the saved form of a flipbook is `frameItems(fb)`, an array of item
 * arrays (one per frame, in order, plus the current index). History is session-only and is not
 * saved; `fromFrames(items, current)` rebuilds a flipbook with empty histories.
 */
import { emptyHistory, type History } from './drawing-history.js';

/** Most frames a flipbook holds. */
export const MAX_FRAMES = 24;

export interface Frame<I = unknown> {
	items: readonly I[];
	history: History<I>;
}

export interface Flipbook<I = unknown> {
	frames: readonly Frame<I>[];
	current: number;
}

const blankFrame = <I>(): Frame<I> => ({ items: [], history: emptyHistory<I>() });

/** A flipbook of one frame holding the board as it is now. */
export const newFlipbook = <I>(items: readonly I[], history: History<I>): Flipbook<I> => ({
	frames: [{ items, history }],
	current: 0
});

/** Rebuild a flipbook from saved frame items (empty histories). Empty input gives one blank frame. */
export const fromFrames = <I>(frames: readonly (readonly I[])[], current = 0): Flipbook<I> => {
	const kept = frames.slice(0, MAX_FRAMES);
	if (kept.length === 0) return { frames: [blankFrame<I>()], current: 0 };
	return {
		frames: kept.map((items) => ({ items, history: emptyHistory<I>() })),
		current: Math.min(Math.max(0, Math.floor(current) || 0), kept.length - 1)
	};
};

/** The items of every frame in order: what a save would write. */
export const frameItems = <I>(fb: Flipbook<I>): (readonly I[])[] => fb.frames.map((f) => f.items);

export const canAdd = (fb: Flipbook): boolean => fb.frames.length < MAX_FRAMES;
export const canDelete = (fb: Flipbook): boolean => fb.frames.length > 1;

/** Write the live working copy back into the current frame. */
export const store = <I>(
	fb: Flipbook<I>,
	items: readonly I[],
	history: History<I>
): Flipbook<I> => ({
	...fb,
	frames: fb.frames.map((f, i) => (i === fb.current ? { items, history } : f))
});

/** Make another frame current (out-of-range indexes are ignored). Call `store` first. */
export const select = <I>(fb: Flipbook<I>, index: number): Flipbook<I> =>
	index === fb.current || index < 0 || index >= fb.frames.length ? fb : { ...fb, current: index };

const insertAfterCurrent = <I>(fb: Flipbook<I>, frame: Frame<I>): Flipbook<I> | null => {
	if (!canAdd(fb)) return null;
	const at = fb.current + 1;
	return { frames: [...fb.frames.slice(0, at), frame, ...fb.frames.slice(at)], current: at };
};

/** A blank frame after the current one, selected. Null at the limit. */
export const addBlank = <I>(fb: Flipbook<I>): Flipbook<I> | null =>
	insertAfterCurrent(fb, blankFrame<I>());

/** A copy of the current frame (fresh history) after it, selected. Null at the limit. */
export const duplicate = <I>(fb: Flipbook<I>): Flipbook<I> | null =>
	insertAfterCurrent(fb, { items: [...fb.frames[fb.current].items], history: emptyHistory<I>() });

/** Delete the current frame; the next one (or the last) becomes current. The only frame stays. */
export const removeCurrent = <I>(fb: Flipbook<I>): Flipbook<I> => {
	if (!canDelete(fb)) return fb;
	const frames = fb.frames.filter((_, i) => i !== fb.current);
	return { frames, current: Math.min(fb.current, frames.length - 1) };
};

/** Move the current frame one place earlier (-1) or later (+1); it stays current. */
export const moveCurrent = <I>(fb: Flipbook<I>, step: -1 | 1): Flipbook<I> => {
	const to = fb.current + step;
	if (to < 0 || to >= fb.frames.length) return fb;
	const frames = [...fb.frames];
	[frames[fb.current], frames[to]] = [frames[to], frames[fb.current]];
	return { frames, current: to };
};

/** The items shown faintly under the current frame (the previous frame), or null on the first. */
export const onionItems = <I>(fb: Flipbook<I>): readonly I[] | null =>
	fb.current > 0 ? fb.frames[fb.current - 1].items : null;
