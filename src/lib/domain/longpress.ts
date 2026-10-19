export interface LongPressOptions {
	/** How long a finger must stay down, in ms. */
	delayMs: number;
	/** Travel in px that turns a press into a drag (a swipe, a scroll) and cancels it. */
	slop: number;
}

export const DEFAULT_LONG_PRESS: LongPressOptions = { delayMs: 600, slop: 10 };

export interface LongPressTimers {
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	/** Milliseconds on a monotonic clock; defaults to performance.now. */
	now?: () => number;
}

export interface LongPress {
	/** A pointer went down at this position. */
	start: (x: number, y: number) => void;
	/** The pointer moved; travelling past the slop cancels the press. */
	move: (x: number, y: number) => void;
	/** The pointer lifted. Returns true when this press had already fired (swallow the click). */
	end: () => boolean;
	/** The gesture was taken over (pointercancel, a second finger). */
	cancel: () => void;
}

/** Whether a movement is big enough to be a drag rather than a held press. */
export function exceedsSlop(dx: number, dy: number, slop: number): boolean {
	return Math.hypot(dx, dy) > slop;
}

/**
 * Long-press recognizer. It fires once, after `delayMs` with the pointer held roughly still. Moving
 * past `slop` cancels it for good, so a swipe (which needs >= 24px of travel) and a long-press
 * never both happen: a press is one or the other, never both.
 */
export function createLongPress(
	onlongpress: () => void,
	options: Partial<LongPressOptions> = {},
	timers: LongPressTimers = {
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
	}
): LongPress {
	// An explicit `undefined` (an unset action param) must fall back to the default, not become 0.
	const delayMs = options.delayMs ?? DEFAULT_LONG_PRESS.delayMs;
	const slop = options.slop ?? DEFAULT_LONG_PRESS.slop;
	const now = timers.now ?? (() => performance.now());
	let origin: { x: number; y: number } | null = null;
	let startedAt = 0;
	let handle: unknown = null;
	let fired = false;

	const clear = () => {
		if (handle !== null) timers.clearTimeout(handle);
		handle = null;
	};

	return {
		start(x, y) {
			clear();
			fired = false;
			origin = { x, y };
			startedAt = now();
			handle = timers.setTimeout(() => {
				handle = null;
				if (!origin) return;
				fired = true;
				onlongpress();
			}, delayMs);
		},
		move(x, y) {
			if (!origin || fired) return;
			if (exceedsSlop(x - origin.x, y - origin.y, slop)) {
				clear();
				origin = null;
			}
		},
		end() {
			// A busy page can run the release before the timer that was due earlier: the finger was
			// down long enough, so it still counts.
			if (!fired && origin && handle !== null && now() - startedAt >= delayMs) {
				clear();
				fired = true;
				onlongpress();
			}
			clear();
			const was = fired;
			fired = false;
			origin = null;
			return was;
		},
		cancel() {
			clear();
			fired = false;
			origin = null;
		}
	};
}
