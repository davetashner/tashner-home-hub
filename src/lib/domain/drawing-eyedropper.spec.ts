import { describe, expect, it } from 'vitest';
import { compositePixel, pixelAt, rgbCss } from './drawing-eyedropper.js';
import { loadDrawing, serializeDrawing } from './drawing-save.js';

describe('compositePixel', () => {
	const paper = [255, 255, 255, 255] as const;
	it('returns the background when no layer has ink', () => {
		expect(compositePixel(paper, [[0, 0, 0, 0]])).toEqual({ r: 255, g: 255, b: 255 });
		expect(compositePixel(paper, [])).toEqual({ r: 255, g: 255, b: 255 });
	});
	it('an opaque layer hides what is below', () => {
		expect(
			compositePixel(paper, [
				[10, 20, 30, 255],
				[200, 100, 50, 255]
			])
		).toEqual({
			r: 200,
			g: 100,
			b: 50
		});
	});
	it('blends a translucent layer over the layers below', () => {
		expect(compositePixel([0, 0, 0, 255], [[255, 255, 255, 128]])).toEqual({
			r: 128,
			g: 128,
			b: 128
		});
		const photo = [0, 0, 255, 255] as const;
		const marker = [255, 0, 0, 128] as const;
		expect(compositePixel(paper, [photo, marker])).toEqual({ r: 128, g: 0, b: 127 });
	});
	it('tolerates out-of-range input', () => {
		expect(compositePixel([300, -5, NaN, 255], [])).toEqual({ r: 255, g: 0, b: 0 });
	});
});

describe('rgbCss', () => {
	it('formats a short rgb() string', () => {
		expect(rgbCss({ r: 1, g: 22, b: 255 })).toBe('rgb(1 22 255)');
		expect(rgbCss({ r: 1.6, g: -3, b: 999 })).toBe('rgb(2 0 255)');
	});
	it('survives a saved-drawing round trip', () => {
		const color = rgbCss({ r: 12, g: 200, b: 99 });
		const json = serializeDrawing(
			[
				{
					tool: 'pen',
					color,
					points: [
						{ x: 1, y: 1, w: 3 },
						{ x: 5, y: 5, w: 3 }
					]
				}
			],
			{ w: 100, h: 100 }
		);
		const back = loadDrawing(json, { w: 100, h: 100 });
		expect(back).toHaveLength(1);
		expect(back![0]).toMatchObject({ color });
	});
});

describe('pixelAt', () => {
	const rect = { left: 10, top: 20, width: 100, height: 50 };
	const canvas = { width: 200, height: 100 };
	it('maps client px to device px', () => {
		expect(pixelAt(60, 45, rect, canvas)).toEqual({ x: 100, y: 50 });
	});
	it('clamps to the canvas', () => {
		expect(pixelAt(-50, 900, rect, canvas)).toEqual({ x: 0, y: 99 });
		expect(pixelAt(500, 0, rect, canvas)).toEqual({ x: 199, y: 0 });
	});
	it('handles a zero-size rect', () => {
		expect(pixelAt(5, 5, { left: 0, top: 0, width: 0, height: 0 }, canvas)).toEqual({ x: 0, y: 0 });
	});
});
