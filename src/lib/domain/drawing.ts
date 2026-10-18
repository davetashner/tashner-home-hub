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
export type DrawTool = 'pen' | 'eraser';

export interface DrawPoint {
	x: number;
	y: number;
	/** Line width in CSS pixels at this point. */
	w: number;
}
export interface Stroke {
	tool: DrawTool;
	color: DrawColor;
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
export function strokeWidth(tool: DrawTool, pointerType: string, pressure: number): number {
	if (tool === 'eraser') return ERASER_WIDTH;
	if (pointerType !== 'pen') return FIXED_WIDTH;
	const p = Number.isFinite(pressure) && pressure > 0 ? Math.min(pressure, 1) : DEFAULT_PRESSURE;
	return PEN_MIN_WIDTH + (PEN_MAX_WIDTH - PEN_MIN_WIDTH) * p;
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
	!strokes.some((s) => s.tool === 'pen' && s.points.length > 0);
