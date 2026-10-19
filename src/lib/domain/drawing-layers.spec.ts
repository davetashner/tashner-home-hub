import { describe, expect, it } from 'vitest';
import {
	ALL_VISIBLE,
	LAYERS,
	LAYER_LABELS,
	allVisible,
	layersFor,
	revealForDrawing,
	toggleLayer
} from './drawing-layers.js';

describe('layers', () => {
	it('starts with everything showing and labels every layer', () => {
		expect(allVisible(ALL_VISIBLE)).toBe(true);
		for (const l of LAYERS) expect(LAYER_LABELS[l].length).toBeGreaterThan(0);
	});
	it('toggles one layer without touching the other or the original', () => {
		const hidden = toggleLayer(ALL_VISIBLE, 'picture');
		expect(hidden).toEqual({ drawing: true, picture: false });
		expect(ALL_VISIBLE.picture).toBe(true);
		expect(allVisible(hidden)).toBe(false);
		expect(toggleLayer(hidden, 'picture')).toEqual(ALL_VISIBLE);
	});
	it('offers the picture layer only when the board has a picture', () => {
		expect(layersFor(false)).toEqual(['drawing']);
		expect(layersFor(true)).toEqual(['drawing', 'picture']);
	});
	it('brings a hidden drawing back for drawing, and leaves the picture alone', () => {
		const v = { drawing: false, picture: false };
		expect(revealForDrawing(v)).toEqual({ drawing: true, picture: false });
		expect(revealForDrawing(ALL_VISIBLE)).toBe(ALL_VISIBLE);
	});
});
