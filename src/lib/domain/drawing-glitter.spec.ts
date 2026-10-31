import { describe, expect, it } from 'vitest';
import {
	BRUSHES,
	MAX_SPARKLES_PER_SEGMENT,
	RAINBOW_PERIOD,
	glitterSparkles,
	isAlphaTool,
	isBrushTool,
	rainbowHue
} from './drawing-brushes.js';

const A = { x: 10, y: 10 };
const B = { x: 60, y: 30 };

describe('rainbowHue', () => {
	it('depends only on length and wraps each period', () => {
		expect(rainbowHue(0)).toBe(0);
		expect(rainbowHue(RAINBOW_PERIOD / 2)).toBeCloseTo(180);
		expect(rainbowHue(RAINBOW_PERIOD)).toBeCloseTo(0);
		expect(rainbowHue(RAINBOW_PERIOD * 2.25)).toBeCloseTo(90);
		expect(rainbowHue(-RAINBOW_PERIOD / 4)).toBeCloseTo(270);
	});
});

describe('glitterSparkles', () => {
	it('is deterministic, capped and well formed', () => {
		const s = glitterSparkles(BRUSHES.glitter, 4, 2, A, B, 20);
		expect(glitterSparkles(BRUSHES.glitter, 4, 2, A, B, 20)).toEqual(s);
		expect(s.length % 4).toBe(0);
		expect(s.length).toBeGreaterThan(0);
		for (let i = 3; i < s.length; i += 4) expect([0, 1, 2]).toContain(s[i]);
		const big = glitterSparkles(BRUSHES.glitter, 4, 0, A, { x: 5000, y: 0 }, 60);
		expect(big.length / 4).toBeLessThanOrEqual(MAX_SPARKLES_PER_SEGMENT);
	});
	it('differs by seed and segment, and a dot still sparkles', () => {
		const s = glitterSparkles(BRUSHES.glitter, 4, 2, A, B, 20);
		expect(glitterSparkles(BRUSHES.glitter, 5, 2, A, B, 20)).not.toEqual(s);
		expect(glitterSparkles(BRUSHES.glitter, 4, 3, A, B, 20)).not.toEqual(s);
		expect(glitterSparkles(BRUSHES.glitter, 4, 0, A, A, 20).length).toBeGreaterThan(0);
	});
	it('includes star glints across a long stroke', () => {
		let stars = 0;
		for (let i = 0; i < 40; i++) {
			const s = glitterSparkles(BRUSHES.glitter, 9, i, A, B, 20);
			for (let k = 3; k < s.length; k += 4) if (s[k] === 2) stars++;
		}
		expect(stars).toBeGreaterThan(0);
	});
});

describe('new brush tools', () => {
	it('register as alpha-aware brushes', () => {
		for (const t of ['glitter', 'rainbow']) {
			expect(isBrushTool(t)).toBe(true);
			expect(isAlphaTool(t)).toBe(true);
		}
	});
});
