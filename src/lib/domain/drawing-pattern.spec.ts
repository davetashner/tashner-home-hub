import { describe, expect, it } from 'vitest';
import {
	FILL_STYLES,
	FILL_STYLE_LABELS,
	PATTERN_IDS,
	isPatternId,
	patternCovers,
	patternTile
} from './drawing-pattern.js';

const share = (tile: Uint8ClampedArray) => {
	let n = 0;
	for (let i = 3; i < tile.length; i += 4) if (tile[i]) n++;
	return n / (tile.length / 4);
};

describe('fill styles', () => {
	it('lists solid first and a label for each', () => {
		expect(FILL_STYLES[0]).toBe('solid');
		for (const s of FILL_STYLES) expect(FILL_STYLE_LABELS[s]).toBeTruthy();
	});
	it('validates pattern ids', () => {
		for (const id of PATTERN_IDS) expect(isPatternId(id)).toBe(true);
		for (const bad of ['solid', 'nope', '', 3, null, undefined, {}])
			expect(isPatternId(bad)).toBe(false);
	});
});

describe('patternTile', () => {
	for (const id of PATTERN_IDS) {
		it(`${id}: partly inked, in the color given, transparent elsewhere`, () => {
			const tile = patternTile(id, 28, [10, 20, 30]);
			expect(tile.length).toBe(28 * 28 * 4);
			const s = share(tile);
			expect(s).toBeGreaterThan(0.05);
			expect(s).toBeLessThan(0.75);
			for (let i = 0; i < tile.length; i += 4) {
				if (tile[i + 3]) expect([...tile.slice(i, i + 4)]).toEqual([10, 20, 30, 255]);
				else expect([...tile.slice(i, i + 4)]).toEqual([0, 0, 0, 0]);
			}
		});
		it(`${id}: repeats seamlessly (edges of the unit tile agree)`, () => {
			for (const t of [0.013, 0.31, 0.77])
				for (const a of [0.001, 0.2])
					expect(patternCovers(id, a, t)).toBe(patternCovers(id, a + 1, t));
		});
	}
	it('clamps a bad size to one pixel', () => {
		expect(patternTile('dots', 0, [0, 0, 0]).length).toBe(4);
		expect(patternTile('dots', -5, [0, 0, 0]).length).toBe(4);
		expect(patternTile('dots', 2.9, [0, 0, 0]).length).toBe(2 * 2 * 4);
	});
	it('differs between patterns', () => {
		const tiles = PATTERN_IDS.map((id) => patternTile(id, 28, [0, 0, 0]).join());
		expect(new Set(tiles).size).toBe(PATTERN_IDS.length);
	});
	it('draws a star centre and leaves the corners clear', () => {
		expect(patternCovers('stars', 0.5, 0.5)).toBe(true);
		expect(patternCovers('stars', 0.02, 0.02)).toBe(false);
	});
	it('draws a dot centre and a brick seam', () => {
		expect(patternCovers('dots', 0.5, 0.5)).toBe(true);
		expect(patternCovers('dots', 0.05, 0.05)).toBe(false);
		expect(patternCovers('bricks', 0.3, 0.02)).toBe(true);
		expect(patternCovers('bricks', 0.3, 0.3)).toBe(false);
		expect(patternCovers('bricks', 0.02, 0.3)).toBe(true);
		expect(patternCovers('bricks', 0.52, 0.8)).toBe(true);
	});
});
