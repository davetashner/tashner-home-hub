/**
 * Saved drawings (hub-cn7.7): a drawing is stored as its item list (strokes, shapes, fills) in a
 * compact JSON form plus the canvas size it was drawn on, so it reopens editable. The same
 * module validates what comes back from the API and refits a drawing to a different canvas
 * (the wall can rotate between landscape and portrait). Pure: no canvas, no storage.
 */
import { FILL_TOLERANCE, isFill, type FillItem } from './drawing-fill.js';
import {
	ALL_SHAPES,
	isShape,
	type DrawItem,
	type DrawTool,
	type Shape,
	type ShapeKind,
	type Stroke
} from './drawing.js';

export const SAVED_MAX_CHARS = 400_000;
export const SAVED_MAX_ITEMS = 2000;
export const SAVED_MAX_POINTS = 20_000;
/** Drawings one person may keep before they must delete one. */
export const SAVED_PER_MEMBER = 12;
/** Reference size a refitted fill's seed is expressed in (the sheet scales it to the real canvas). */
export const FILL_REF = 10_000;

export interface Size {
	w: number;
	h: number;
}

type WireStroke = { t: DrawTool; c: string; p: number[] };
type WireShape = { s: ShapeKind; c: string; f: boolean; w: number; b: number[] };
type WireFill = { k: 1; c: string; x: number; y: number; o: number };
type WireItem = WireStroke | WireShape | WireFill;
interface Wire {
	v: 1;
	size: Size;
	items: WireItem[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * JSON for a drawing made on a canvas of `size` CSS px; `dpr` converts a fill's device-pixel seed.
 * Fill runs are dropped: they are recomputed from the seed when the drawing reopens.
 */
export function serializeDrawing(items: readonly DrawItem[], size: Size, dpr = 1): string {
	const wire: Wire = {
		v: 1,
		size: { w: r1(size.w), h: r1(size.h) },
		items: items.map((it): WireItem => {
			if (isFill(it))
				return { k: 1, c: it.color, x: r1(it.x / dpr), y: r1(it.y / dpr), o: it.tolerance };
			if (isShape(it))
				return {
					s: it.shape,
					c: it.color,
					f: it.filled,
					w: r1(it.width),
					b: [it.x0, it.y0, it.x1, it.y1].map(r1)
				};
			return { t: it.tool, c: it.color, p: it.points.flatMap((p) => [r1(p.x), r1(p.y), r1(p.w)]) };
		})
	};
	return JSON.stringify(wire);
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const color = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const TOOLS: readonly string[] = ['pen', 'highlighter', 'eraser'];

/** The wire form, or null when the text is not a well-formed drawing within the size limits. */
function parseWire(json: unknown): Wire | null {
	if (typeof json !== 'string' || json.length > SAVED_MAX_CHARS) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	const w = raw as Partial<Wire> | null;
	if (
		!w ||
		w.v !== 1 ||
		!w.size ||
		!num(w.size.w) ||
		!num(w.size.h) ||
		w.size.w < 1 ||
		w.size.h < 1
	)
		return null;
	if (!Array.isArray(w.items) || w.items.length > SAVED_MAX_ITEMS) return null;
	let points = 0;
	for (const it of w.items as Record<string, unknown>[]) {
		if (!it || typeof it !== 'object' || !color(it.c)) return null;
		if ('k' in it) {
			if (it.k !== 1 || !num(it.x) || !num(it.y) || !num(it.o)) return null;
		} else if ('s' in it) {
			const b = it.b;
			if (
				!(ALL_SHAPES as readonly unknown[]).includes(it.s) ||
				typeof it.f !== 'boolean' ||
				!num(it.w) ||
				!Array.isArray(b) ||
				b.length !== 4 ||
				!b.every(num)
			)
				return null;
		} else {
			const p = it.p;
			if (
				!TOOLS.includes(it.t as string) ||
				!Array.isArray(p) ||
				p.length % 3 !== 0 ||
				!p.every(num)
			)
				return null;
			points += p.length / 3;
			if (points > SAVED_MAX_POINTS) return null;
		}
	}
	return w as Wire;
}

/** True when `json` is a drawing this module would load. */
export const isSavedDrawing = (json: unknown): boolean => parseWire(json) !== null;

/** The canvas size a saved drawing was made on, or null when it is not valid. */
export function savedSize(json: unknown): Size | null {
	return parseWire(json)?.size ?? null;
}

/**
 * Items for a canvas of `to` CSS px: the drawing is scaled uniformly to fit and centred, so a
 * landscape drawing opened in portrait is smaller but never distorted. Returns null for bad input.
 * Fills come back without runs, with their seed in FILL_REF units, for the sheet to re-flood.
 */
export function loadDrawing(json: unknown, to: Size): DrawItem[] | null {
	const wire = parseWire(json);
	if (!wire) return null;
	const s = Math.min(to.w / wire.size.w, to.h / wire.size.h);
	const ox = (to.w - wire.size.w * s) / 2;
	const oy = (to.h - wire.size.h * s) / 2;
	const X = (x: number) => x * s + ox;
	const Y = (y: number) => y * s + oy;
	return wire.items.map((it): DrawItem => {
		if ('k' in it) {
			const f: FillItem = {
				fill: true,
				color: it.c,
				x: (X(it.x) / to.w) * FILL_REF,
				y: (Y(it.y) / to.h) * FILL_REF,
				w: FILL_REF,
				h: FILL_REF,
				tolerance: it.o || FILL_TOLERANCE,
				spans: new Uint32Array(0)
			};
			return f;
		}
		if ('s' in it) {
			const [x0, y0, x1, y1] = it.b;
			const sh: Shape = {
				shape: it.s,
				color: it.c,
				filled: it.f,
				width: it.w * s,
				x0: X(x0),
				y0: Y(y0),
				x1: X(x1),
				y1: Y(y1)
			};
			return sh;
		}
		const st: Stroke = { tool: it.t, color: it.c, points: [] };
		for (let i = 0; i < it.p.length; i += 3)
			st.points.push({ x: X(it.p[i]), y: Y(it.p[i + 1]), w: it.p[i + 2] * s });
		return st;
	});
}
