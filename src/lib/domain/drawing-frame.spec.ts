import { describe, expect, it } from 'vitest';
import {
	DRAWING_ID_PREFIX,
	drawingEntry,
	firstName,
	interleaveDrawings,
	isDrawingId,
	isDrawingMode
} from './drawing-frame.js';
import type { SlidePhoto } from './slideshow.js';

const photos = (n: number): SlidePhoto[] =>
	Array.from({ length: n }, (_, i) => ({ id: `p${i}`, w: 1, h: 1 }));
const cards = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ id: `d${i}`, name: `K${i}`, src: `/d${i}.png` }));
const ids = (l: SlidePhoto[]) => l.map((p) => p.id);

describe('interleaveDrawings', () => {
	it('puts one drawing after every N photos, each once', () => {
		expect(ids(interleaveDrawings(photos(6), cards(3), 2))).toEqual([
			'p0',
			'p1',
			'drawing:d0',
			'p2',
			'p3',
			'drawing:d1',
			'p4',
			'p5',
			'drawing:d2'
		]);
	});
	it('stops when the drawings run out', () => {
		expect(ids(interleaveDrawings(photos(4), cards(1), 2))).toEqual([
			'p0',
			'p1',
			'drawing:d0',
			'p2',
			'p3'
		]);
	});
	it('still shows one in a short pass', () => {
		expect(ids(interleaveDrawings(photos(2), cards(2), 5))).toEqual(['p0', 'p1', 'drawing:d0']);
	});
	it('leaves photos alone with no drawings, and plays drawings alone with no photos', () => {
		expect(ids(interleaveDrawings(photos(3), []))).toEqual(['p0', 'p1', 'p2']);
		expect(ids(interleaveDrawings([], cards(2)))).toEqual(['drawing:d0']);
	});
	it('treats a nonsense gap as 1 and uses the default of 5', () => {
		expect(ids(interleaveDrawings(photos(2), cards(2), 0))).toEqual([
			'p0',
			'drawing:d0',
			'p1',
			'drawing:d1'
		]);
		expect(interleaveDrawings(photos(10), cards(2)).filter((p) => p.drawing)).toHaveLength(2);
	});
});

describe('helpers', () => {
	it('takes the first name', () => {
		expect(firstName('  Ada  Lovelace ')).toBe('Ada');
		expect(firstName('')).toBe('');
	});
	it('marks drawing entries', () => {
		const e = drawingEntry(cards(1)[0]);
		expect(e.id.startsWith(DRAWING_ID_PREFIX)).toBe(true);
		expect(isDrawingId(e.id)).toBe(true);
		expect(isDrawingId('p1')).toBe(false);
		expect(e.drawing).toEqual({ name: 'K0', src: '/d0.png' });
	});
	it('validates the mode', () => {
		expect(isDrawingMode('on')).toBe(true);
		expect(isDrawingMode('yes')).toBe(false);
	});
});
