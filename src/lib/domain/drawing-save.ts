/**
 * Saved drawings (hub-cn7.7): a drawing is stored as its item list (strokes, shapes, fills) in a
 * compact JSON form plus the canvas size it was drawn on, so it reopens editable. The same
 * module validates what comes back from the API and refits a drawing to a different canvas
 * (the wall can rotate between landscape and portrait). Pure: no canvas, no storage.
 */
import { PAGE_SIZE, isPageId, pageFit, type PageId } from './drawing-pages.js';
import { FILL_TOLERANCE, isFill, type FillItem } from './drawing-fill.js';
import {
	ALL_SHAPES,
	COLOR_GRID,
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
/** `r` (hub-cn7.5) is the turn in radians; saves made before it have none and open upright. */
type WireShape = { s: ShapeKind; c: string; f: boolean; w: number; b: number[]; r?: number };
type WireFill = { k: 1; c: string; x: number; y: number; o: number };
type WireItem = WireStroke | WireShape | WireFill;
interface Wire {
	v: 1;
	size: Size;
	/** A coloring page under the drawing: items are then stored in page space. */
	page?: PageId;
	/** Background color of the board (hub-cn7.9.1): one of COLOR_GRID; absent means paper. */
	bg?: string;
	items: WireItem[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * JSON for a drawing made on a canvas of `size` CSS px; `dpr` converts a fill's device-pixel seed.
 * Fill runs are dropped: they are recomputed from the seed when the drawing reopens. With a
 * coloring `page`, items are stored in the page's own space, so they stay on its lines whatever
 * shape the canvas is when the drawing reopens.
 */
export function serializeDrawing(
	items: readonly DrawItem[],
	size: Size,
	dpr = 1,
	page: PageId | null = null,
	bg: string | null = null
): string {
	const fit = page ? pageFit(size) : { s: 1, ox: 0, oy: 0 };
	const X = (x: number) => r1((x - fit.ox) / fit.s);
	const Y = (y: number) => r1((y - fit.oy) / fit.s);
	const K = (k: number) => r1(k / fit.s);
	const wire: Wire = {
		v: 1,
		size: page ? { ...PAGE_SIZE } : { w: r1(size.w), h: r1(size.h) },
		...(page ? { page } : {}),
		...(bg && isBackground(bg) ? { bg } : {}),
		items: items.map((it): WireItem => {
			if (isFill(it))
				return { k: 1, c: it.color, x: X(it.x / dpr), y: Y(it.y / dpr), o: it.tolerance };
			if (isShape(it))
				return {
					s: it.shape,
					c: it.color,
					f: it.filled,
					w: K(it.width),
					b: [X(it.x0), Y(it.y0), X(it.x1), Y(it.y1)],
					...(it.rot ? { r: Math.round(it.rot * 1000) / 1000 } : {})
				};
			return {
				t: it.tool,
				c: it.color,
				p: it.points.flatMap((p) => [X(p.x), Y(p.y), K(p.w)])
			};
		})
	};
	return JSON.stringify(wire);
}

/** A background the board accepts: a color from the grid. */
export const isBackground = (v: unknown): v is string =>
	typeof v === 'string' && COLOR_GRID.includes(v);

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInk = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
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
	if (w.page !== undefined && !isPageId(w.page)) return null;
	if (w.bg !== undefined && !isBackground(w.bg)) return null;
	if (!Array.isArray(w.items) || w.items.length > SAVED_MAX_ITEMS) return null;
	let points = 0;
	for (const it of w.items as Record<string, unknown>[]) {
		if (!it || typeof it !== 'object' || !isInk(it.c)) return null;
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
				!b.every(num) ||
				(it.r !== undefined && !num(it.r))
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

/** The coloring page a saved drawing sits on, or null for a plain board. */
export const savedPage = (json: unknown): PageId | null => parseWire(json)?.page ?? null;

/** The background color a saved drawing was made on, or null for plain paper. */
export const savedBackground = (json: unknown): string | null => parseWire(json)?.bg ?? null;

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
				y1: Y(y1),
				...(it.r ? { rot: it.r } : {})
			};
			return sh;
		}
		const st: Stroke = { tool: it.t, color: it.c, points: [] };
		for (let i = 0; i < it.p.length; i += 3)
			st.points.push({ x: X(it.p[i]), y: Y(it.p[i + 1]), w: it.p[i + 2] * s });
		return st;
	});
}
