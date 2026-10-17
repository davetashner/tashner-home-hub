import type { Action } from 'svelte/action';
import { createLongPress, type LongPress, type LongPressOptions } from '#lib/domain/longpress.js';

export interface LongPressParams extends Partial<LongPressOptions> {
	onlongpress: () => void;
}

/**
 * Pointer-event long-press. Use as `use:longpress={{ onlongpress }}`. A press that fired also eats the
 * click that follows it, and the browser's own long-press menu is suppressed.
 */
export const longpress: Action<HTMLElement, LongPressParams> = (node, initial) => {
	let params = initial;
	let tracking: number | null = null;
	let swallow = false;
	const recognizer: LongPress = createLongPress(() => params.onlongpress(), {
		delayMs: params.delayMs,
		slop: params.slop
	});

	const down = (e: PointerEvent) => {
		if (tracking !== null || (e.pointerType === 'mouse' && e.button !== 0)) {
			// A second finger turns this into a pinch or two-finger gesture, not a long-press.
			if (tracking !== null) recognizer.cancel();
			return;
		}
		tracking = e.pointerId;
		swallow = false;
		recognizer.start(e.clientX, e.clientY);
	};
	const move = (e: PointerEvent) => {
		if (e.pointerId === tracking) recognizer.move(e.clientX, e.clientY);
	};
	const up = (e: PointerEvent) => {
		if (e.pointerId !== tracking) return;
		tracking = null;
		swallow = recognizer.end();
	};
	const cancel = (e: PointerEvent) => {
		if (e.pointerId !== tracking) return;
		tracking = null;
		recognizer.cancel();
	};
	const click = (e: MouseEvent) => {
		if (!swallow) return;
		swallow = false;
		e.preventDefault();
		e.stopPropagation();
	};
	const menu = (e: Event) => e.preventDefault();

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	// On the window: the sheet that a fired press opens sits under the finger and gets the release.
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	node.addEventListener('contextmenu', menu);
	return {
		update: (next) => (params = next),
		destroy() {
			recognizer.cancel();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
			node.removeEventListener('contextmenu', menu);
		}
	};
};
