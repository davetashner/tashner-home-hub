/**
 * Time-lapse replay (hub-cn7.22): a saved drawing keeps its items in drawing order, so it can be
 * shown being made. This module is the timeline only: given the items it says how many are
 * finished and how far the current stroke has got at any moment, scaled so a whole drawing takes
 * about REPLAY_MS at 1x however big it is. It never paints and never changes the items; the board
 * paints each frame through its normal paint path, so every item kind replays. Pure: no canvas.
 */
export const REPLAY_MS = 10_000;
export const REPLAY_SPEEDS = [1, 2] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** A shape, fill or any item without points counts as this many stroke points of drawing time. */
export const ITEM_WEIGHT = 12;
/** A pause after the last item so the finished picture is seen before the replay ends. */
export const REPLAY_HOLD_MS = 600;

/** Anything with an optional `points` list: strokes reveal point by point, other items whole. */
type Replayable = object;
const pointsOf = (it: Replayable): unknown[] | null => {
	const p = (it as { points?: unknown }).points;
	return Array.isArray(p) ? p : null;
};

export interface ReplaySchedule {
	/** Per item, the time (ms at 1x) at which it starts. */
	starts: number[];
	/** Per item, how many ms it takes to draw. */
	spans: number[];
	/** Point count of each item (0 for items that appear whole). */
	counts: number[];
	/** When the last item is done (ms at 1x), before the hold. */
	drawMs: number;
	/** Drawing plus the closing hold. */
	totalMs: number;
}

const pointCount = (it: Replayable): number => pointsOf(it)?.length ?? 0;

/** The timeline for `items`: each takes time in proportion to its points, the sum is `target`. */
export function buildSchedule(items: readonly Replayable[], target = REPLAY_MS): ReplaySchedule {
	const counts = items.map(pointCount);
	const weights = counts.map((n) => (n > 0 ? n : ITEM_WEIGHT));
	const sum = weights.reduce((a, b) => a + b, 0);
	const per = sum > 0 ? target / sum : 0;
	const starts: number[] = [];
	const spans: number[] = [];
	let at = 0;
	for (const w of weights) {
		starts.push(at);
		spans.push(w * per);
		at += w * per;
	}
	return {
		starts,
		spans,
		counts,
		drawMs: at,
		totalMs: items.length ? at + REPLAY_HOLD_MS : 0
	};
}

export interface ReplayFrame {
	/** Items 0..done-1 are complete. */
	done: number;
	/** The item being drawn right now and how many of its points show, or null between items. */
	partial: { index: number; points: number } | null;
	/** True once the replay has played through (including the hold). */
	finished: boolean;
}

/** What to show `elapsed` ms (already multiplied by speed) into the replay. */
export function frameAt(schedule: ReplaySchedule, elapsed: number): ReplayFrame {
	const n = schedule.starts.length;
	const t = Math.max(0, elapsed);
	const finished = t >= schedule.totalMs;
	if (t >= schedule.drawMs) return { done: n, partial: null, finished };
	// Last item whose start is <= t (binary search: schedules can hold thousands of items).
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (schedule.starts[mid] <= t) lo = mid;
		else hi = mid - 1;
	}
	const count = schedule.counts[lo];
	if (count === 0) return { done: lo, partial: null, finished };
	const frac = schedule.spans[lo] > 0 ? (t - schedule.starts[lo]) / schedule.spans[lo] : 1;
	const points = Math.min(count, Math.max(1, Math.ceil(frac * count)));
	return points >= count
		? { done: lo + 1, partial: null, finished }
		: { done: lo, partial: { index: lo, points }, finished };
}

/** The items to paint for a frame: the finished ones plus the partly drawn stroke (a copy). */
export function itemsAt<T extends Replayable>(items: readonly T[], frame: ReplayFrame): T[] {
	const out = items.slice(0, frame.done);
	if (frame.partial) {
		const it = items[frame.partial.index];
		out.push({ ...it, points: (pointsOf(it) ?? []).slice(0, frame.partial.points) });
	}
	return out;
}

/** 1x -> 2x -> 1x. */
export const nextSpeed = (s: ReplaySpeed): ReplaySpeed =>
	REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(s) + 1) % REPLAY_SPEEDS.length];
