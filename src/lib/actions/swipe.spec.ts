import { describe, expect, it, vi } from 'vitest';
import { swipe } from './swipe.js';

function pointer(type: string, x: number, y: number, t: number, id = 1) {
	return Object.defineProperties(new Event(type), {
		clientX: { value: x },
		clientY: { value: y },
		timeStamp: { value: t },
		pointerId: { value: id }
	});
}

function setup() {
	const node = new EventTarget() as unknown as HTMLElement;
	const onswipe = vi.fn();
	const action = swipe(node, { onswipe })!;
	return { node, onswipe, action };
}

describe('swipe action', () => {
	it('fires onswipe with the direction', () => {
		const { node, onswipe } = setup();
		node.dispatchEvent(pointer('pointerdown', 300, 100, 0));
		node.dispatchEvent(pointer('pointerup', 100, 110, 200));
		expect(onswipe).toHaveBeenCalledWith('left');
	});

	it('ignores taps, other pointers and cancelled gestures', () => {
		const { node, onswipe } = setup();
		node.dispatchEvent(pointer('pointerup', 0, 0, 10));
		node.dispatchEvent(pointer('pointerdown', 10, 10, 0));
		node.dispatchEvent(pointer('pointerup', 12, 10, 50));
		node.dispatchEvent(pointer('pointerdown', 0, 0, 0, 1));
		node.dispatchEvent(pointer('pointerup', 300, 0, 100, 2));
		node.dispatchEvent(pointer('pointerdown', 0, 0, 0));
		node.dispatchEvent(new Event('pointercancel'));
		node.dispatchEvent(pointer('pointerup', 300, 0, 100));
		expect(onswipe).not.toHaveBeenCalled();
	});

	it('supports updated params and removes listeners on destroy', () => {
		const { node, onswipe, action } = setup();
		const next = vi.fn();
		action.update?.({ onswipe: next });
		node.dispatchEvent(pointer('pointerdown', 0, 0, 0));
		node.dispatchEvent(pointer('pointerup', 0, 200, 100));
		expect(next).toHaveBeenCalledWith('down');
		action.destroy?.();
		node.dispatchEvent(pointer('pointerdown', 0, 0, 0));
		node.dispatchEvent(pointer('pointerup', 200, 0, 100));
		expect(onswipe).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledTimes(1);
	});
});
