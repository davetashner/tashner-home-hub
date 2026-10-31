/**
 * Text on the drawing board (hub-cn7.23): a line or two of big lettering a kid can place, move,
 * resize, turn, recolor and edit like a shape. The box turns about its centre (`rot`), so the
 * shape editing maths in drawing-edit.ts is reused through a box stand-in. Pure: the sheet
 * supplies the canvas text measurer, so no canvas or DOM is needed here.
 */
import {
	SHAPE_MIN_SIZE,
	handlePoints,
	hitBody,
	moveShape,
	rotatePoint,
	rotateShape,
	rotationOf,
	selectionCorners,
	shapeCenter,
	type Pt
} from './drawing-edit.js';
import { shapeBounds, type InkColor, type Shape } from './drawing.js';

export const TEXT_SIZES = ['small', 'medium', 'large', 'huge'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** Letter height in CSS px for each size choice. */
export const TEXT_SIZE_PX: Record<TextSize, number> = {
	small: 48,
	medium: 80,
	large: 128,
	huge: 200
};
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
	small: 'Small',
	medium: 'Medium',
	large: 'Big',
	huge: 'Huge'
};
export const TEXT_MIN_SIZE = 24;
export const TEXT_MAX_SIZE = 400;
export const TEXT_MAX_CHARS = 200;
/** Line height as a multiple of the letter size. */
export const TEXT_LINE_HEIGHT = 1.2;
/** Heavy, rounded lettering: weight 800 of the app's `--font-sans`. */
export const TEXT_WEIGHT = 800;

/** Text on the board. The box (x0,y0)-(x1,y1) is the laid-out text, not yet turned by `rot`. */
export interface TextItem {
	text: string;
	color: InkColor;
	/** Letter size in CSS px. */
	size: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	rot?: number;
}
export const isText = (item: object): item is TextItem => 'text' in item;

export const cleanText = (raw: string): string => raw.slice(0, TEXT_MAX_CHARS).replace(/\s+$/, '');

export const textLines = (text: string): string[] => text.split('\n');

export const textFont = (size: number, family: string): string =>
	`${TEXT_WEIGHT} ${size}px ${family}`;

export function layoutText(
	text: string,
	size: number,
	measure: (line: string) => number
): { w: number; h: number } {
	const lines = textLines(text);
	const w = Math.max(...lines.map(measure), size / 2);
	return { w, h: lines.length * size * TEXT_LINE_HEIGHT };
}

export function makeText(
	text: string,
	color: InkColor,
	size: number,
	at: Pt,
	measure: (line: string) => number
): TextItem {
	const { w, h } = layoutText(text, size, measure);
	return { text, color, size, x0: at.x, y0: at.y, x1: at.x + w, y1: at.y + h };
}

export function relayoutText(t: TextItem, measure: (line: string) => number): TextItem {
	const { w, h } = layoutText(t.text, t.size, measure);
	const x0 = Math.min(t.x0, t.x1);
	const y0 = Math.min(t.y0, t.y1);
	return { ...t, x0, y0, x1: x0 + w, y1: y0 + h };
}

const box = (t: TextItem): Shape => ({
	shape: 'square',
	color: t.color,
	filled: false,
	width: 0,
	x0: t.x0,
	y0: t.y0,
	x1: t.x1,
	y1: t.y1,
	rot: t.rot
});
const withBox = (t: TextItem, b: Shape): TextItem => ({
	...t,
	...{ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, rot: b.rot }
});

export const hitText = (t: TextItem, p: Pt): boolean => hitBody(box(t), p);
export const textHandles = (t: TextItem) => handlePoints(box(t));
export const textCorners = (t: TextItem): Pt[] => selectionCorners(box(t));
export const moveText = (t: TextItem, dx: number, dy: number): TextItem =>
	withBox(t, moveShape(box(t), dx, dy));
export const rotateText = (t: TextItem, from: Pt, to: Pt): TextItem =>
	withBox(t, rotateShape(box(t), from, to));

export function textAt(items: readonly object[], p: Pt): TextItem | null {
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (isText(it) && hitText(it, p)) return it;
	}
	return null;
}

export function scaleText(t: TextItem, size: number): TextItem {
	const s = Math.min(TEXT_MAX_SIZE, Math.max(TEXT_MIN_SIZE, size));
	const k = s / t.size;
	const b = shapeBounds(t);
	const c = shapeCenter(t);
	// Keep the box's top-left corner fixed on the board, whatever the turn.
	const anchor = rotatePoint({ x: b.x, y: b.y }, c, rotationOf(t));
	const w = b.w * k;
	const h = b.h * k;
	const mid = rotatePoint({ x: w / 2, y: h / 2 }, { x: 0, y: 0 }, rotationOf(t));
	return {
		...t,
		size: s,
		x0: anchor.x + mid.x - w / 2,
		y0: anchor.y + mid.y - h / 2,
		x1: anchor.x + mid.x + w / 2,
		y1: anchor.y + mid.y + h / 2
	};
}

export function resizeText(t: TextItem, p: Pt): TextItem {
	const r = rotationOf(t);
	const b = shapeBounds(t);
	const anchor = rotatePoint({ x: b.x, y: b.y }, shapeCenter(t), r);
	const d = rotatePoint({ x: p.x - anchor.x, y: p.y - anchor.y }, { x: 0, y: 0 }, -r);
	const diag = b.w * b.w + b.h * b.h;
	const k = diag === 0 ? 1 : (d.x * b.w + d.y * b.h) / diag;
	return scaleText(t, t.size * k);
}

export type TextStyle = Partial<Pick<TextItem, 'color'>> & { size?: number };

export function restyleText(t: TextItem, style: TextStyle): TextItem {
	let next = t;
	if (style.color !== undefined && style.color !== t.color) next = { ...next, color: style.color };
	if (style.size !== undefined && style.size !== t.size) next = scaleText(next, style.size);
	return next;
}

export function textOrigin(tap: Pt, size: number, board: { w: number; h: number }): Pt {
	const margin = SHAPE_MIN_SIZE / 2;
	const h = size * TEXT_LINE_HEIGHT;
	return {
		x: Math.max(margin, Math.min(tap.x, board.w - size * 3)),
		y: Math.max(margin, Math.min(tap.y - h / 2, board.h - h - margin))
	};
}
