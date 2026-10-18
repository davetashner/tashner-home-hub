import { describe, expect, it } from 'vitest';
import {
	BRUSH_SCALE,
	COLOR_GRID,
	GRID_HUES,
	HIGHLIGHTER_WIDTH,
	RECENT_MAX,
	isInkToken,
	pushRecent,
	ERASER_WIDTH,
	FIXED_WIDTH,
	PEN_MAX_WIDTH,
	PEN_MIN_WIDTH,
	createPalmGuard,
	dataUrlBytes,
	fitWithin,
	isBlank,
	smoothWidth,
	strokeWidth,
	undoStroke,
	type Stroke
} from './drawing.js';

const stroke = (tool: Stroke['tool'], n = 2): Stroke => ({
	tool,
	color: 'draw-black',
	points: Array.from({ length: n }, (_, i) => ({ x: i, y: i, w: 4 }))
});

describe('stroke width', () => {
	it('maps pen pressure between the min and max widths', () => {
		expect(strokeWidth('pen', 'pen', 1)).toBe(PEN_MAX_WIDTH);
		expect(strokeWidth('pen', 'pen', 0.01)).toBeCloseTo(PEN_MIN_WIDTH, 0);
		expect(strokeWidth('pen', 'pen', 0.5)).toBe((PEN_MIN_WIDTH + PEN_MAX_WIDTH) / 2);
		expect(strokeWidth('pen', 'pen', 7)).toBe(PEN_MAX_WIDTH);
	});
	it('treats missing pressure as a light touch', () => {
		const mid = (PEN_MIN_WIDTH + PEN_MAX_WIDTH) / 2;
		expect(strokeWidth('pen', 'pen', 0)).toBe(mid);
		expect(strokeWidth('pen', 'pen', NaN)).toBe(mid);
	});
	it('gives fingers and mice one fixed width, and the eraser its own', () => {
		expect(strokeWidth('pen', 'touch', 0.9)).toBe(FIXED_WIDTH);
		expect(strokeWidth('pen', 'mouse', 0.5)).toBe(FIXED_WIDTH);
		expect(strokeWidth('eraser', 'pen', 1)).toBe(ERASER_WIDTH);
		expect(strokeWidth('eraser', 'touch', 0)).toBe(ERASER_WIDTH);
	});
	it('smooths towards the target', () => {
		expect(smoothWidth(10, 20)).toBe(14);
		expect(smoothWidth(10, 20, 1)).toBe(20);
	});
});

describe('palm rejection', () => {
	it('accepts touch until a pen has been seen, then ignores it', () => {
		const g = createPalmGuard();
		expect(g.accepts('touch')).toBe(true);
		g.see('touch');
		expect(g.penSeen).toBe(false);
		expect(g.accepts('touch')).toBe(true);
		g.see('pen');
		expect(g.penSeen).toBe(true);
		expect(g.accepts('touch')).toBe(false);
		expect(g.accepts('pen')).toBe(true);
		expect(g.accepts('mouse')).toBe(true);
	});
});

describe('strokes', () => {
	it('undoes the last stroke without mutating', () => {
		const all = [stroke('pen'), stroke('eraser')];
		expect(undoStroke(all)).toHaveLength(1);
		expect(all).toHaveLength(2);
		expect(undoStroke([])).toEqual([]);
	});
	it('is blank when there is no ink', () => {
		expect(isBlank([])).toBe(true);
		expect(isBlank([stroke('eraser')])).toBe(true);
		expect(isBlank([stroke('pen', 0)])).toBe(true);
		expect(isBlank([stroke('eraser'), stroke('pen')])).toBe(false);
	});
});

describe('export size', () => {
	it('scales the long side to the limit and never enlarges', () => {
		expect(fitWithin(3840, 2160)).toEqual({ width: 1024, height: 576 });
		expect(fitWithin(1000, 2000)).toEqual({ width: 512, height: 1024 });
		expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
		expect(fitWithin(5000, 1, 100)).toEqual({ width: 100, height: 1 });
	});
	it('counts the bytes in a data URL', () => {
		expect(dataUrlBytes('data:image/png;base64,QUJD')).toBe(3);
		expect(dataUrlBytes('data:image/png;base64,QUI=')).toBe(2);
		expect(dataUrlBytes('data:image/png;base64,QQ==')).toBe(1);
	});
});

describe('brush sizes, highlighter, colors', () => {
	it('size presets scale the pen width and still follow pressure', () => {
		expect(strokeWidth('pen', 'pen', 1, 'marker')).toBe(PEN_MAX_WIDTH * BRUSH_SCALE.marker);
		expect(strokeWidth('pen', 'pen', 1, 'thin')).toBeLessThan(
			strokeWidth('pen', 'pen', 1, 'thick')
		);
		expect(strokeWidth('pen', 'pen', 0.2, 'thick')).toBeLessThan(
			strokeWidth('pen', 'pen', 0.9, 'thick')
		);
		expect(strokeWidth('pen', 'touch', 0.5, 'thick')).toBe(FIXED_WIDTH * BRUSH_SCALE.thick);
	});
	it('the highlighter is wide, ignores pressure and scales with size', () => {
		expect(strokeWidth('highlighter', 'pen', 0.1)).toBe(HIGHLIGHTER_WIDTH);
		expect(strokeWidth('highlighter', 'pen', 1)).toBe(HIGHLIGHTER_WIDTH);
		expect(strokeWidth('highlighter', 'touch', 1, 'thin')).toBe(
			HIGHLIGHTER_WIDTH * BRUSH_SCALE.thin
		);
	});
	it('a board with only highlighter ink is not blank', () => {
		expect(isBlank([stroke('highlighter')])).toBe(false);
	});
	it('the color grid is hues by three shades of oklch colors', () => {
		expect(COLOR_GRID).toHaveLength(GRID_HUES.length * 3);
		expect(new Set(COLOR_GRID).size).toBe(COLOR_GRID.length);
		expect(COLOR_GRID.every((c) => c.startsWith('oklch('))).toBe(true);
	});
	it('tells ink tokens from computed colors', () => {
		expect(isInkToken('draw-red')).toBe(true);
		expect(isInkToken(COLOR_GRID[0])).toBe(false);
	});
	it('recent colors: newest first, no duplicates, capped', () => {
		expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
		expect(pushRecent(['a'], 'c')).toEqual(['c', 'a']);
		const many = Array.from({ length: RECENT_MAX }, (_, i) => `c${i}`);
		expect(pushRecent(many, 'new')).toHaveLength(RECENT_MAX);
		expect(pushRecent(many, 'new')[0]).toBe('new');
	});
});
