import { describe, expect, it } from 'vitest';
import { PLAY_SPEEDS, fpsOf, frameAt, nextSpeed } from './drawing-flipbook-play.js';

describe('flipbook playback timing', () => {
	it('steps one frame per tick and loops', () => {
		expect(frameAt(0, 3, 4)).toBe(0);
		expect(frameAt(249, 3, 4)).toBe(0);
		expect(frameAt(250, 3, 4)).toBe(1);
		expect(frameAt(750, 3, 4)).toBe(0);
		expect(frameAt(1000, 3, 2, 1)).toBe(0);
	});
	it('holds still for one frame, bad speed or negative time', () => {
		expect(frameAt(5000, 1, 4)).toBe(0);
		expect(frameAt(5000, 3, 0)).toBe(0);
		expect(frameAt(-50, 3, 4)).toBe(0);
	});
	it('cycles speeds', () => {
		expect(PLAY_SPEEDS.map((s) => fpsOf(s.id))).toEqual([2, 4, 8]);
		expect(nextSpeed('slow')).toBe('medium');
		expect(nextSpeed('fast')).toBe('slow');
		expect(fpsOf('nope' as 'slow')).toBe(4);
	});
});
