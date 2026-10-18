import type { Action } from 'svelte/action';
import { detectSwipe, type SwipeDirection, type SwipeOptions } from '#lib/domain/swipe.js';

export interface SwipeParams extends Partial<SwipeOptions> {
	onswipe: (direction: SwipeDirection) => void;
}

/**
 * Pointer-event swipe recognizer. Use as `use:swipe={{ onswipe: (d) => ... }}`.
 * Anything inside a `data-no-swipe` element never starts a swipe.
 * Pair with `touch-action: pan-y` (or none) on the element so the browser does
 * not claim the gesture.
 */
export const swipe: Action<HTMLElement, SwipeParams> = (node, initial) => {
	let params = initial;
	let start: { x: number; y: number; t: number; id: number } | null = null;

	const down = (e: PointerEvent) => {
		// Surfaces that draw or drag (the drawing board) own their gestures: no page swipes from them.
		if ((e.target as Element | null)?.closest?.('[data-no-swipe]')) return;
		start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
	};
	const up = (e: PointerEvent) => {
		if (!start || start.id !== e.pointerId) return;
		const { onswipe, ...options } = params;
		const direction = detectSwipe(
			e.clientX - start.x,
			e.clientY - start.y,
			e.timeStamp - start.t,
			options
		);
		start = null;
		if (direction) onswipe(direction);
	};
	const cancel = () => (start = null);

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', cancel);
	return {
		update: (next) => (params = next),
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', cancel);
		}
	};
};
