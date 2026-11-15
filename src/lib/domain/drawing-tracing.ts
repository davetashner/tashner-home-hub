/**
 * Letter and number tracing pages (hub-t27j.13): each glyph is a few centre-line strokes in a
 * 60 x 100 box. A page turns them into dotted guides plus a start circle and arrow per stroke,
 * as paths in the 1000 x 700 page space, so they ride the coloring-page layer the eraser cannot
 * touch. Pure: path maths only.
 */
import type { PathCmd } from './drawing.js';

export const TRACE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export type TraceId = `trace-${string}`;
export const traceId = (ch: string): TraceId => `trace-${ch}`;
export const traceChar = (id: unknown): string | null => {
	if (typeof id !== 'string' || !id.startsWith('trace-')) return null;
	const ch = id.slice(6);
	return ch.length === 1 && TRACE_CHARS.includes(ch) ? ch : null;
};
export const isTraceId = (v: unknown): v is TraceId => traceChar(v) !== null;

type Pt = [number, number];
/** Points along an ellipse arc; angles in degrees, 0 = right, 90 = down, either direction. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
	const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 15));
	return Array.from({ length: n + 1 }, (_, i): Pt => {
		const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
		return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
	});
}

const GLYPHS: Record<string, Pt[][]> = {
	A: [
		[
			[0, 100],
			[30, 0],
			[60, 100]
		],
		[
			[12, 60],
			[48, 60]
		]
	],
	B: [
		[
			[0, 0],
			[0, 100]
		],
		[[0, 0], [30, 0], ...arc(30, 25, 25, 25, -90, 90), [0, 50]],
		[[0, 50], [32, 50], ...arc(32, 75, 25, 25, -90, 90), [0, 100]]
	],
	C: [arc(32, 50, 30, 50, -45, -315)],
	D: [
		[
			[0, 0],
			[0, 100]
		],
		[[0, 0], [20, 0], ...arc(20, 50, 40, 50, -90, 90), [0, 100]]
	],
	E: [
		[
			[60, 0],
			[0, 0],
			[0, 100],
			[60, 100]
		],
		[
			[0, 50],
			[45, 50]
		]
	],
	F: [
		[
			[60, 0],
			[0, 0],
			[0, 100]
		],
		[
			[0, 50],
			[45, 50]
		]
	],
	G: [[...arc(30, 50, 30, 50, -40, -320), [60, 52], [32, 52]]],
	H: [
		[
			[0, 0],
			[0, 100]
		],
		[
			[60, 0],
			[60, 100]
		],
		[
			[0, 50],
			[60, 50]
		]
	],
	I: [
		[
			[30, 0],
			[30, 100]
		],
		[
			[10, 0],
			[50, 0]
		],
		[
			[10, 100],
			[50, 100]
		]
	],
	J: [[[45, 0], [45, 70], ...arc(25, 70, 20, 30, 0, 180)]],
	K: [
		[
			[0, 0],
			[0, 100]
		],
		[
			[60, 0],
			[0, 58]
		],
		[
			[18, 40],
			[60, 100]
		]
	],
	L: [
		[
			[0, 0],
			[0, 100],
			[60, 100]
		]
	],
	M: [
		[
			[0, 100],
			[0, 0],
			[30, 60],
			[60, 0],
			[60, 100]
		]
	],
	N: [
		[
			[0, 100],
			[0, 0],
			[60, 100],
			[60, 0]
		]
	],
	O: [arc(30, 50, 30, 50, -90, 270)],
	P: [
		[
			[0, 0],
			[0, 100]
		],
		[[0, 0], [30, 0], ...arc(30, 27, 28, 27, -90, 90), [0, 54]]
	],
	Q: [
		arc(30, 50, 30, 50, -90, 270),
		[
			[38, 70],
			[60, 100]
		]
	],
	R: [
		[
			[0, 0],
			[0, 100]
		],
		[[0, 0], [30, 0], ...arc(30, 27, 28, 27, -90, 90), [0, 54]],
		[
			[25, 54],
			[60, 100]
		]
	],
	S: [[...arc(30, 25, 26, 25, -30, -270), ...arc(30, 75, 26, 25, -90, 150)]],
	T: [
		[
			[0, 0],
			[60, 0]
		],
		[
			[30, 0],
			[30, 100]
		]
	],
	U: [[[0, 0], [0, 65], ...arc(30, 65, 30, 35, 180, 0), [60, 0]]],
	V: [
		[
			[0, 0],
			[30, 100],
			[60, 0]
		]
	],
	W: [
		[
			[0, 0],
			[15, 100],
			[30, 30],
			[45, 100],
			[60, 0]
		]
	],
	X: [
		[
			[0, 0],
			[60, 100]
		],
		[
			[60, 0],
			[0, 100]
		]
	],
	Y: [
		[
			[0, 0],
			[30, 50],
			[60, 0]
		],
		[
			[30, 50],
			[30, 100]
		]
	],
	Z: [
		[
			[0, 0],
			[60, 0],
			[0, 100],
			[60, 100]
		]
	],
	'0': [arc(30, 50, 28, 50, -90, 270)],
	'1': [
		[
			[10, 20],
			[30, 0],
			[30, 100]
		]
	],
	'2': [[...arc(30, 28, 27, 28, -180, 40), [0, 100], [60, 100]]],
	'3': [[...arc(28, 25, 26, 25, -150, 90), ...arc(28, 75, 30, 25, -90, 150)]],
	'4': [
		[
			[40, 0],
			[0, 68],
			[60, 68]
		],
		[
			[40, 0],
			[40, 100]
		]
	],
	'5': [[[55, 0], [8, 0], [5, 45], ...arc(28, 70, 30, 30, -130, 130)]],
	'6': [[[48, 0], [20, 25], [2, 70], ...arc(30, 70, 28, 30, 180, 540)]],
	'7': [
		[
			[0, 0],
			[60, 0],
			[22, 100]
		]
	],
	'8': [arc(30, 25, 24, 25, 90, -270), arc(30, 75, 28, 25, -90, 270)],
	'9': [[...arc(30, 30, 28, 30, 0, -360), [50, 70], [15, 100]]]
};

/** Page-space size of the glyph box: 5 units per glyph unit, centred on the 1000 x 700 page. */
const K = 5;
const OX = 350;
const OY = 100;
/** Gap between guide dots, in page units. */
export const DOT_GAP = 22;
const DOT_R = 1.5;
const START_R = 14;

const place = ([x, y]: Pt): Pt => [OX + x * K, OY + y * K];

/** Points spaced `gap` apart along a polyline, always including both ends. */
export function dotsAlong(pts: Pt[], gap: number): Pt[] {
	const out: Pt[] = [];
	if (pts.length === 0 || gap <= 0) return out;
	out.push(pts[0]);
	let carry = 0;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1];
		const [x1, y1] = pts[i];
		const len = Math.hypot(x1 - x0, y1 - y0);
		let d = gap - carry;
		while (d <= len) {
			out.push([x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len]);
			d += gap;
		}
		carry = len - (d - gap);
	}
	const last = pts[pts.length - 1];
	const prev = out[out.length - 1];
	if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > gap * 0.4) out.push(last);
	return out;
}

/** A start marker: a ring on the first point and an arrow beside it pointing along the stroke. */
function startMark(from: Pt, toward: Pt): PathCmd[][] {
	const [x, y] = from;
	const len = Math.hypot(toward[0] - x, toward[1] - y) || 1;
	const dx = (toward[0] - x) / len;
	const dy = (toward[1] - y) / len;
	// The arrow sits behind the start, tip just off the ring.
	const tipX = x - dx * (START_R + 8);
	const tipY = y - dy * (START_R + 8);
	const tailX = tipX - dx * 50;
	const tailY = tipY - dy * 50;
	const head = (s: number): PathCmd[] => {
		const a = Math.atan2(dy, dx) + Math.PI + s * 0.5;
		return [
			['M', tipX, tipY],
			['L', tipX + Math.cos(a) * 22, tipY + Math.sin(a) * 22]
		];
	};
	return [
		[['E', x, y, START_R, START_R]],
		[
			['M', tailX, tailY],
			['L', tipX, tipY]
		],
		head(1),
		head(-1)
	];
}

/** The guide for one glyph in page space: dotted centre lines plus a start ring and arrow per stroke. */
export function tracingPaths(ch: string): PathCmd[][] {
	const strokes = GLYPHS[ch];
	if (!strokes) return [];
	const out: PathCmd[][] = [];
	for (const raw of strokes) {
		const pts = raw.map(place);
		for (const [x, y] of dotsAlong(pts, DOT_GAP)) out.push([['E', x, y, DOT_R, DOT_R]]);
		out.push(...startMark(pts[0], pts[Math.min(3, pts.length - 1)]));
	}
	return out;
}

/** How many strokes a glyph has (the number of start arrows). */
export const strokeCount = (ch: string): number => GLYPHS[ch]?.length ?? 0;
