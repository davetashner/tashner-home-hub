import { describe, expect, it } from 'vitest';
import { starsFor } from './score.js';

describe('starsFor', () => {
	it('gives nothing for a loss', () => {
		expect(starsFor(false, 3)).toBe(0);
	});
	it('counts Junkbots to spare on a win', () => {
		expect(starsFor(true, 0)).toBe(1);
		expect(starsFor(true, 1)).toBe(2);
		expect(starsFor(true, 2)).toBe(3);
		expect(starsFor(true, 5)).toBe(3);
	});
});
