import { describe, expect, it } from 'vitest';
import { detectSwipe } from './swipe.js';

describe('detectSwipe', () => {
	it('detects the four directions past the distance threshold', () => {
		expect(detectSwipe(120, 0, 400)).toBe('right');
		expect(detectSwipe(-120, 0, 400)).toBe('left');
		expect(detectSwipe(0, 120, 400)).toBe('down');
		expect(detectSwipe(0, -120, 400)).toBe('up');
	});

	it('ignores taps and tiny movements, even if instant', () => {
		expect(detectSwipe(3, -2, 10)).toBeNull();
		expect(detectSwipe(20, 0, 1)).toBeNull();
	});

	it('ignores slow short drags', () => {
		expect(detectSwipe(50, 0, 1000)).toBeNull();
	});

	it('accepts short fast flicks', () => {
		expect(detectSwipe(-40, 0, 50)).toBe('left');
	});

	it('resolves diagonals to the dominant axis', () => {
		expect(detectSwipe(100, 60, 300)).toBe('right');
		expect(detectSwipe(60, -100, 300)).toBe('up');
		expect(detectSwipe(100, 100, 300)).toBe('right');
	});

	it('honours custom options and zero elapsed time', () => {
		expect(detectSwipe(30, 0, 400, { distance: 25, minDistance: 10 })).toBe('right');
		expect(detectSwipe(40, 0, 0)).toBe('right');
	});
});
