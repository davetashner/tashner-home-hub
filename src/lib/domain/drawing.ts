/**
 * Drawing board maths (hub-fkp): pen pressure to line width, palm rejection, undo, and
 * fitting the export under the note image limits. Pure: the canvas itself lives in the sheet.
 */

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
export type DrawTool = 'pen' | 'highlighter' | 'eraser';

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
	const scale = BRUSH_SCALE[size];
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

/** The strokes after undoing the last one. */
export const undoStroke = (strokes: readonly Stroke[]): Stroke[] => strokes.slice(0, -1);

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
export const isBlank = (strokes: readonly Stroke[]): boolean =>
	!strokes.some((s) => s.tool !== 'eraser' && s.points.length > 0);
