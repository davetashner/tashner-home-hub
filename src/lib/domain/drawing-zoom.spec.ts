import { describe, expect, it } from 'vitest';
import {
	FIT,
	clampView,
	distance,
	isFit,
	midpoint,
	pinch,
	toBoard,
	toScreen,
	viewCss
} from './drawing-zoom.js';

const size = { w: 800, h: 600 };

describe('drawing zoom', () => {
	it('maps screen to board and back', () => {
		const v = { scale: 2, x: -100, y: -50 };
		expect(toBoard(v, { x: 300, y: 250 })).toEqual({ x: 200, y: 150 });
		expect(toScreen(v, { x: 200, y: 150 })).toEqual({ x: 300, y: 250 });
		expect(toBoard(FIT, { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
	});

	it('clamps scale to 1x-4x and keeps the board covering the holder', () => {
		expect(clampView({ scale: 9, x: 0, y: 0 }, size).scale).toBe(4);
		expect(clampView({ scale: 0.2, x: -40, y: -40 }, size)).toEqual(FIT);
		expect(clampView({ scale: 2, x: 50, y: 50 }, size)).toEqual({ scale: 2, x: 0, y: 0 });
		expect(clampView({ scale: 2, x: -5000, y: -5000 }, size)).toEqual({
			scale: 2,
			x: -800,
			y: -600
		});
		expect(clampView({ scale: NaN, x: 0, y: 0 }, size)).toEqual(FIT);
	});

	it('zooms around the midpoint', () => {
		const a0 = { x: 300, y: 300 };
		const b0 = { x: 500, y: 300 };
		const v = pinch(FIT, a0, b0, { x: 200, y: 300 }, { x: 600, y: 300 }, size);
		expect(v.scale).toBe(2);
		// The board point under the midpoint stays under it.
		const m = midpoint(a0, b0);
		expect(toScreen(v, toBoard(FIT, m))).toEqual(m);
	});

	it('pans when the fingers move together', () => {
		const start = { scale: 2, x: -400, y: -300 };
		const v = pinch(
			start,
			{ x: 300, y: 300 },
			{ x: 400, y: 300 },
			{ x: 350, y: 320 },
			{ x: 450, y: 320 },
			size
		);
		expect(v).toEqual({ scale: 2, x: -350, y: -280 });
	});

	it('cannot zoom past 4x or pan the board away', () => {
		const v = pinch(
			FIT,
			{ x: 390, y: 300 },
			{ x: 410, y: 300 },
			{ x: 0, y: 300 },
			{ x: 800, y: 300 },
			size
		);
		expect(v.scale).toBe(4);
		const out = pinch(
			v,
			{ x: 300, y: 300 },
			{ x: 400, y: 300 },
			{ x: 9900, y: 9900 },
			{ x: 10000, y: 9900 },
			size
		);
		expect(out.x).toBe(0);
		expect(out.y).toBe(0);
	});

	it('zooming back out reaches fit', () => {
		const z = { scale: 2, x: -200, y: -100 };
		const v = pinch(z, { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, size);
		expect(isFit(v)).toBe(true);
	});

	it('ignores a zero-distance start', () => {
		const p = { x: 10, y: 10 };
		expect(pinch(FIT, p, p, p, { x: 90, y: 10 }, size).scale).toBe(1);
	});

	it('basic helpers', () => {
		expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
		expect(isFit({ scale: 2, x: 0, y: 0 })).toBe(false);
		expect(viewCss({ scale: 2, x: -10, y: -20 })).toBe('translate(-10px, -20px) scale(2)');
	});
});
