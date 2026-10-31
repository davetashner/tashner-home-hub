/**
 * Drawing board maths (hub-fkp): pen pressure to line width, palm rejection, undo, and
 * fitting the export under the note image limits. Pure: the canvas itself lives in the sheet.
 */

import type { Mirror } from './drawing-mirror.js';
import { isFill, type FillItem } from './drawing-fill.js';
import { BRUSHES, isBrushTool, type BrushTool } from './drawing-brushes.js';
import { stampParts } from './drawing-stamps.js';
import {
	EXTRA_DEFAULT_ASPECT,
	EXTRA_SHAPE_KINDS,
	extraShapeParts
} from './drawing-shapes-extra.js';

/** Ink and eraser choices. Colors are `--color-draw-*` tokens read at runtime (canvas cannot use classes). */
export const DRAW_COLORS = [
	'draw-black',
	'draw-red',
	'draw-orange',
	'draw-green',
	'draw-blue',
	'draw-purple'
] as const;
export type DrawColor = (typeof DRAW_COLORS)[number];
export type DrawTool = 'pen' | 'highlighter' | 'eraser' | BrushTool;

/**
 * A stroke color: a `--color-draw-*` token name (the six ink swatches) or a CSS color string
 * computed in oklch (the color grid). Tokens are resolved at draw time, anything else is used as is.
 */
export type InkColor = string;
export const isInkToken = (c: string): c is DrawColor =>
	(DRAW_COLORS as readonly string[]).includes(c);

/** Kid-friendly color grid: a few hues across, three shades down, all computed in oklch. */
export const GRID_HUES = [20, 55, 95, 145, 195, 250, 305, 350] as const;
const GRID_SHADES = [
	{ l: 0.82, c: 0.12 }, // light
	{ l: 0.62, c: 0.2 }, // bright
	{ l: 0.4, c: 0.14 } // deep
] as const;
export const COLOR_GRID: readonly string[] = GRID_SHADES.flatMap((s) =>
	GRID_HUES.map((h) => `oklch(${s.l * 100}% ${s.c} ${h})`)
);

export const RECENT_MAX = 6;
/** Most recent first, no duplicates, capped. */
export const pushRecent = (recent: readonly string[], color: string, max = RECENT_MAX): string[] =>
	[color, ...recent.filter((c) => c !== color)].slice(0, max);

export const BRUSH_SIZES = ['thin', 'medium', 'thick', 'marker'] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];
/** Multiplier on the pen's width, so presets combine with pressure. */
export const BRUSH_SCALE: Record<BrushSize, number> = {
	thin: 0.5,
	medium: 1,
	thick: 1.8,
	marker: 3
};
export const HIGHLIGHTER_WIDTH = 26;
export const HIGHLIGHTER_ALPHA = 0.4;

export interface DrawPoint {
	x: number;
	y: number;
	/** Line width in CSS pixels at this point. */
	w: number;
}
export interface Stroke {
	tool: DrawTool;
	color: InkColor;
	points: DrawPoint[];
	/** Mirror mode (hub-cn7.18): painted once per copy, still one stroke (one undo step). */
	mirror?: Mirror;
	/** Opacity 0.1-1 of a pen stroke (hub-cn7.13); absent means opaque. Highlighter keeps HIGHLIGHTER_ALPHA. */
	alpha?: number;
	/** Seeds a textured brush's grain (hub-cn7.19); absent on plain pens and older saves (0). */
	seed?: number;
}

export const PEN_MIN_WIDTH = 2;
export const PEN_MAX_WIDTH = 18;
/** Fingers and mice report no useful pressure: they get one fixed width. */
export const FIXED_WIDTH = 7;
export const ERASER_WIDTH = 36;

/** A pen reporting pressure 0 (some report that on hover or no support) is treated as a light touch. */
const DEFAULT_PRESSURE = 0.5;

/** Line width in CSS px for one pointer sample. Pressure only matters for pens drawing ink. */
export function strokeWidth(
	tool: DrawTool,
	pointerType: string,
	pressure: number,
	size: BrushSize = 'medium'
): number {
	if (tool === 'eraser') return ERASER_WIDTH;
	const scale = BRUSH_SCALE[size] * (isBrushTool(tool) ? BRUSHES[tool].widthScale : 1);
	// A highlighter is a flat wide marker: pressure would make the translucent band uneven.
	if (tool === 'highlighter') return HIGHLIGHTER_WIDTH * scale;
	if (pointerType !== 'pen') return FIXED_WIDTH * scale;
	const p = Number.isFinite(pressure) && pressure > 0 ? Math.min(pressure, 1) : DEFAULT_PRESSURE;
	return (PEN_MIN_WIDTH + (PEN_MAX_WIDTH - PEN_MIN_WIDTH) * p) * scale;
}

/** Low-pass the width so a jittery pressure signal does not make the line pulse. */
export const smoothWidth = (previous: number, target: number, amount = 0.4): number =>
	previous + (target - previous) * amount;

/**
 * Palm rejection: once a pen has been seen in this session, touch pointers are ignored
 * (a resting palm reads as touch). Mouse and pen are always accepted.
 */
export function createPalmGuard() {
	let penSeen = false;
	return {
		/** Call for every pointer event, including hover, so the pen is noticed before it touches. */
		see(pointerType: string): void {
			if (pointerType === 'pen') penSeen = true;
		},
		accepts(pointerType: string): boolean {
			return !(penSeen && pointerType === 'touch');
		},
		get penSeen(): boolean {
			return penSeen;
		}
	};
}

/** Everything on the board, in drawing order: freehand strokes and inserted shapes share one undo list. */
export type DrawItem = Stroke | Shape | FillItem;
export const isShape = (item: DrawItem): item is Shape => 'shape' in item;

/** The items after undoing the last one (a stroke or a whole inserted shape). */
export const undoStroke = <T extends DrawItem>(strokes: readonly T[]): T[] => strokes.slice(0, -1);

// --- Shapes and stamps (hub-cn7.2) ---------------------------------------------------------

export const SHAPE_KINDS = [
	'circle',
	'square',
	'triangle',
	'star',
	'heart',
	'line',
	'arrow',
	...EXTRA_SHAPE_KINDS
] as const;
export const STAMP_KINDS = [
	'sun',
	'flower',
	'smiley',
	'bubble',
	'cat',
	'dog',
	'fish',
	'bird',
	'house',
	'tree',
	'rocket',
	'car',
	'butterfly'
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number] | (typeof STAMP_KINDS)[number];
export const ALL_SHAPES: readonly ShapeKind[] = [...SHAPE_KINDS, ...STAMP_KINDS];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
	circle: 'Circle',
	square: 'Square',
	triangle: 'Triangle',
	star: 'Star',
	heart: 'Heart',
	line: 'Line',
	arrow: 'Arrow',
	oval: 'Oval',
	diamond: 'Diamond',
	pentagon: 'Pentagon',
	hexagon: 'Hexagon',
	rounded: 'Rounded rectangle',
	moon: 'Crescent moon',
	cloud: 'Cloud',
	bolt: 'Lightning bolt',
	rainbow: 'Rainbow',
	doublearrow: 'Double arrow',
	sun: 'Sun',
	flower: 'Flower',
	smiley: 'Smiley',
	bubble: 'Speech bubble',
	cat: 'Cat',
	dog: 'Dog',
	fish: 'Fish',
	bird: 'Bird',
	house: 'House',
	tree: 'Tree',
	rocket: 'Rocket',
	car: 'Car',
	butterfly: 'Butterfly'
};

/** A placed shape: the drag's two corners (a line's two ends), the ink and how it is drawn. */
export interface Shape {
	shape: ShapeKind;
	color: InkColor;
	filled: boolean;
	/** Outline width in CSS pixels. */
	width: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Turn in radians about the box centre (hub-cn7.5). Absent means upright; lines bake it into their ends. */
	rot?: number;
	/** Opacity 0.1-1 (hub-cn7.13); absent means opaque. */
	alpha?: number;
}

export type PathCmd =
	| ['M' | 'L', number, number]
	| ['C', number, number, number, number, number, number]
	| ['E', number, number, number, number] // ellipse: center x, y, radius x, y (own subpath)
	| ['Z'];
/**
 * One piece of a shape. `body` is outlined (and filled when the shape is filled), `solid` is
 * always filled (eyes, flower centre), `line` is only ever stroked (smile, rays).
 */
export interface ShapePart {
	kind: 'body' | 'solid' | 'line';
	cmds: PathCmd[];
}

/** A tap (or a drag shorter than this) places the shape at this default size, centered on the tap. */
export const SHAPE_DEFAULT_SIZE = 120;
export const SHAPE_MIN_DRAG = 12;
export const SHAPE_STROKE = FIXED_WIDTH;

/** Outline width for the current brush size. */
export const shapeWidth = (size: BrushSize): number => FIXED_WIDTH * BRUSH_SCALE[size];

export const isLineShape = (k: ShapeKind): boolean => k === 'line' || k === 'arrow';

/**
 * The two corners a placement gesture makes. A tap or tiny drag gives a default-size shape
 * centered on the tap (a line gets a horizontal default); a bigger drag is used as is.
 */
export function placement(
	kind: ShapeKind,
	from: { x: number; y: number },
	to: { x: number; y: number }
): { x0: number; y0: number; x1: number; y1: number } {
	if (Math.hypot(to.x - from.x, to.y - from.y) >= SHAPE_MIN_DRAG)
		return { x0: from.x, y0: from.y, x1: to.x, y1: to.y };
	const h = SHAPE_DEFAULT_SIZE / 2;
	if (isLineShape(kind)) return { x0: from.x - h, y0: from.y, x1: from.x + h, y1: from.y };
	const v = h * (EXTRA_DEFAULT_ASPECT[kind] ?? 1);
	return { x0: from.x - h, y0: from.y - v, x1: from.x + h, y1: from.y + v };
}

/** The box a shape occupies (normalized, so dragging up and left works). */
export function shapeBounds(s: Pick<Shape, 'x0' | 'y0' | 'x1' | 'y1'>) {
	const x = Math.min(s.x0, s.x1);
	const y = Math.min(s.y0, s.y1);
	return { x, y, w: Math.abs(s.x1 - s.x0), h: Math.abs(s.y1 - s.y0) };
}

/** True when a point lands on the shape's box, with some slack for fingers. */
export function hitShape(s: Shape, px: number, py: number, slop = s.width + 8): boolean {
	const b = shapeBounds(s);
	return px >= b.x - slop && px <= b.x + b.w + slop && py >= b.y - slop && py <= b.y + b.h + slop;
}

const poly = (pts: [number, number][]): PathCmd[] => [
	...pts.map((p, i): PathCmd => [i === 0 ? 'M' : 'L', p[0], p[1]]),
	['Z']
];

function starPoints(cx: number, cy: number, rx: number, ry: number, n: number, inner: number) {
	const pts: [number, number][] = [];
	for (let i = 0; i < n * 2; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / n;
		const k = i % 2 === 0 ? 1 : inner;
		pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
	}
	return pts;
}

/** Vector outline of a shape or stamp for the dragged corners. Pure geometry, no canvas. */
export function shapeParts(s: Pick<Shape, 'shape' | 'x0' | 'y0' | 'x1' | 'y1'>): ShapePart[] {
	const { x, y, w, h } = shapeBounds(s);
	const cx = x + w / 2;
	const cy = y + h / 2;
	const rx = w / 2;
	const ry = h / 2;
	switch (s.shape) {
		case 'circle':
			return [{ kind: 'body', cmds: [['E', cx, cy, rx, ry]] }];
		case 'square':
			return [
				{
					kind: 'body',
					cmds: poly([
						[x, y],
						[x + w, y],
						[x + w, y + h],
						[x, y + h]
					])
				}
			];
		case 'triangle':
			return [
				{
					kind: 'body',
					cmds: poly([
						[cx, y],
						[x + w, y + h],
						[x, y + h]
					])
				}
			];
		case 'star':
			return [{ kind: 'body', cmds: poly(starPoints(cx, cy, rx, ry, 5, 0.42)) }];
		case 'heart':
			return [
				{
					kind: 'body',
					cmds: [
						['M', cx, y + h * 0.3],
						['C', cx, y, x, y, x, y + h * 0.35],
						['C', x, y + h * 0.62, cx - w * 0.2, y + h * 0.8, cx, y + h],
						['C', cx + w * 0.2, y + h * 0.8, x + w, y + h * 0.62, x + w, y + h * 0.35],
						['C', x + w, y, cx, y, cx, y + h * 0.3],
						['Z']
					]
				}
			];
		case 'line':
			return [
				{
					kind: 'line',
					cmds: [
						['M', s.x0, s.y0],
						['L', s.x1, s.y1]
					]
				}
			];
		case 'arrow': {
			const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
			const head = Math.min(len * 0.4, 40);
			const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
			const wing = (d: number): PathCmd[] => [
				['M', s.x1, s.y1],
				['L', s.x1 - Math.cos(a + d) * head, s.y1 - Math.sin(a + d) * head]
			];
			return [
				{
					kind: 'line',
					cmds: [
						['M', s.x0, s.y0],
						['L', s.x1, s.y1]
					]
				},
				{ kind: 'line', cmds: [...wing(Math.PI / 6), ...wing(-Math.PI / 6)] }
			];
		}
		case 'sun': {
			const rays: PathCmd[] = [];
			for (let i = 0; i < 8; i++) {
				const a = (i * Math.PI) / 4;
				rays.push(
					['M', cx + Math.cos(a) * rx * 0.68, cy + Math.sin(a) * ry * 0.68],
					['L', cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
				);
			}
			return [
				{ kind: 'body', cmds: [['E', cx, cy, rx * 0.5, ry * 0.5]] },
				{ kind: 'line', cmds: rays }
			];
		}
		case 'flower': {
			const petals: PathCmd[] = [];
			for (let i = 0; i < 5; i++) {
				const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
				petals.push([
					'E',
					cx + Math.cos(a) * rx * 0.55,
					cy + Math.sin(a) * ry * 0.55,
					rx * 0.4,
					ry * 0.4
				]);
			}
			return [
				...petals.map((p): ShapePart => ({ kind: 'body', cmds: [p] })),
				{ kind: 'solid', cmds: [['E', cx, cy, rx * 0.22, ry * 0.22]] }
			];
		}
		case 'oval':
		case 'diamond':
		case 'pentagon':
		case 'hexagon':
		case 'rounded':
		case 'moon':
		case 'cloud':
		case 'bolt':
		case 'rainbow':
		case 'doublearrow':
			return extraShapeParts(s.shape, { x, y, w, h });
		case 'bubble':
		case 'cat':
		case 'dog':
		case 'fish':
		case 'bird':
		case 'house':
		case 'tree':
		case 'rocket':
		case 'car':
		case 'butterfly':
			return stampParts(s.shape, { x, y, w, h });
		case 'smiley':
			return [
				{ kind: 'body', cmds: [['E', cx, cy, rx, ry]] },
				{ kind: 'solid', cmds: [['E', cx - rx * 0.35, cy - ry * 0.25, rx * 0.1, ry * 0.12]] },
				{ kind: 'solid', cmds: [['E', cx + rx * 0.35, cy - ry * 0.25, rx * 0.1, ry * 0.12]] },
				{
					kind: 'line',
					cmds: [
						['M', cx - rx * 0.5, cy + ry * 0.2],
						[
							'C',
							cx - rx * 0.3,
							cy + ry * 0.7,
							cx + rx * 0.3,
							cy + ry * 0.7,
							cx + rx * 0.5,
							cy + ry * 0.2
						]
					]
				}
			];
	}
}

export const MAX_EXPORT_SIDE = 1024;

/** Export size: the canvas scaled so its long side is at most `max` (never enlarged), at least 1px. */
export function fitWithin(
	width: number,
	height: number,
	max = MAX_EXPORT_SIDE
): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/** Bytes a base64 data URL decodes to. */
export function dataUrlBytes(dataUrl: string): number {
	const comma = dataUrl.indexOf(',');
	const b64 = dataUrl.slice(comma + 1);
	const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
	return Math.floor((b64.length * 3) / 4) - pad;
}

/** True when a stroke list would leave the board blank (nothing but erasing, or nothing). */
export const isBlank = (strokes: readonly DrawItem[]): boolean =>
	!strokes.some((s) => isShape(s) || isFill(s) || (s.tool !== 'eraser' && s.points.length > 0));
