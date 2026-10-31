import { describe, expect, it } from 'vitest';
import {
	TEXT_MAX_CHARS,
	TEXT_MAX_SIZE,
	TEXT_MIN_SIZE,
	cleanText,
	hitText,
	layoutText,
	makeText,
	moveText,
	relayoutText,
	resizeText,
	restyleText,
	rotateText,
	scaleText,
	textCorners,
	textFont,
	textHandles,
	textOrigin
} from './drawing-text.js';
import { isBlank } from './drawing.js';

/** 0.5 of the letter size per character, like a monospace font. */
const measureAt = (size: number) => (line: string) => line.length * size * 0.5;
const make = (text = 'Hi', size = 80, at = { x: 100, y: 100 }) =>
	makeText(text, 'draw-red', size, at, measureAt(size));

describe('text layout', () => {
	it('sizes the box to the widest line and the line count', () => {
		expect(layoutText('Hello\nHi', 100, measureAt(100))).toEqual({ w: 250, h: 240 });
	});
	it('places text at a point and relayouts when it changes', () => {
		expect(make('Hey', 80)).toMatchObject({ x0: 100, y0: 100, x1: 220, y1: 196, size: 80 });
		const t = relayoutText({ ...make('Hey'), text: 'Hello' }, measureAt(80));
		expect([t.x0, t.x1]).toEqual([100, 300]);
	});
	it('cleans text: caps the length and drops trailing blank space', () => {
		expect(cleanText('Hi  \n\n')).toBe('Hi');
		expect(cleanText('a'.repeat(TEXT_MAX_CHARS + 5))).toHaveLength(TEXT_MAX_CHARS);
		expect(textFont(48, 'Nunito')).toBe('800 48px Nunito');
	});
	it('counts as ink', () => expect(isBlank([make()])).toBe(false));
});

describe('text editing', () => {
	it('hits its box with slack and misses far away', () => {
		const t = make('Hey', 80);
		expect(hitText(t, { x: 150, y: 150 })).toBe(true);
		expect(hitText(t, { x: 500, y: 500 })).toBe(false);
	});
	it('moves, turns and exposes handles', () => {
		const t = make('Hey', 80);
		const m = moveText(t, 10, -5);
		expect(m).toMatchObject({ x0: 110, y0: 95, x1: 230, y1: 191 });
		const r = rotateText(t, { x: 260, y: 148 }, { x: 160, y: 248 });
		expect(r.rot).toBeCloseTo(Math.PI / 2);
		expect(textHandles(t).rotate.y).toBeLessThan(t.y0);
		expect(textCorners(t)).toHaveLength(4);
	});
	it('scales to a size, clamped, keeping the top-left corner', () => {
		const t = make('Hey', 80);
		const big = scaleText(t, 160);
		expect(big).toMatchObject({ size: 160, x0: 100, y0: 100, x1: 340, y1: 292 });
		expect(scaleText(t, 1).size).toBe(TEXT_MIN_SIZE);
		expect(scaleText(t, 9999).size).toBe(TEXT_MAX_SIZE);
	});
	it('resizes by dragging the corner handle', () => {
		const t = make('Hey', 80);
		const grown = resizeText(t, { x: 100 + 240, y: 100 + 192 });
		expect(grown.size).toBeCloseTo(160);
		expect(resizeText(t, { x: 100, y: 100 }).size).toBe(TEXT_MIN_SIZE);
	});
	it('recolors and resizes, returning the same object when nothing changes', () => {
		const t = make();
		expect(restyleText(t, {})).toBe(t);
		expect(restyleText(t, { color: 'draw-red', size: t.size })).toBe(t);
		expect(restyleText(t, { color: 'draw-blue' }).color).toBe('draw-blue');
		expect(restyleText(t, { size: 120 }).size).toBe(120);
	});
	it('keeps the starting point on the board', () => {
		const board = { w: 1000, h: 600 };
		expect(textOrigin({ x: 400, y: 300 }, 100, board)).toEqual({ x: 400, y: 240 });
		expect(textOrigin({ x: -50, y: -50 }, 100, board)).toEqual({ x: 12, y: 12 });
	});
});
