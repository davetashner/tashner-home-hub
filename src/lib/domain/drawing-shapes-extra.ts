/** Ten more outline shapes (hub-cn7.15): geometry in the dragged box, pure and canvas-free. */
import type { PathCmd, ShapeKind, ShapePart } from './drawing.js';

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The kinds this module draws. */
export const EXTRA_SHAPE_KINDS = [
	'oval',
	'diamond',
	'pentagon',
	'hexagon',
	'rounded',
	'moon',
	'cloud',
	'bolt',
	'rainbow',
	'doublearrow'
] as const;
export type ExtraShapeKind = (typeof EXTRA_SHAPE_KINDS)[number];
export const isExtraShape = (k: ShapeKind): k is ExtraShapeKind =>
	(EXTRA_SHAPE_KINDS as readonly string[]).includes(k);

/** Default (tap) box for kinds that should not start square: an oval starts wider than tall. */
export const EXTRA_DEFAULT_ASPECT: Partial<Record<ShapeKind, number>> = { oval: 0.62 };

const K = 0.5523; // quarter-circle bezier constant

const poly = (pts: [number, number][]): PathCmd[] => [
	...pts.map((p, i): PathCmd => [i === 0 ? 'M' : 'L', p[0], p[1]]),
	['Z']
];

const regular = (b: Box, n: number): PathCmd[] =>
	poly(
		Array.from({ length: n }, (_, i): [number, number] => {
			const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
			return [b.x + b.w / 2 + (Math.cos(a) * b.w) / 2, b.y + b.h / 2 + (Math.sin(a) * b.h) / 2];
		})
	);

/** Quarter arcs of an ellipse about (cx, cy) from the left end over the top to the right end. */
const arch = (cx: number, cy: number, rx: number, ry: number): PathCmd[] => [
	['C', cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry],
	['C', cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy]
];
/** The same arch walked right to left. */
const archBack = (cx: number, cy: number, rx: number, ry: number): PathCmd[] => [
	['C', cx + rx, cy - K * ry, cx + K * rx, cy - ry, cx, cy - ry],
	['C', cx - K * rx, cy - ry, cx - rx, cy - K * ry, cx - rx, cy]
];

export function extraShapeParts(kind: ExtraShapeKind, b: Box): ShapePart[] {
	const X = (f: number) => b.x + b.w * f;
	const Y = (f: number) => b.y + b.h * f;
	const cx = b.x + b.w / 2;
	const cy = b.y + b.h / 2;
	const body = (cmds: PathCmd[]): ShapePart[] => [{ kind: 'body', cmds }];
	switch (kind) {
		case 'oval':
			return body([['E', cx, cy, b.w / 2, b.h / 2]]);
		case 'diamond':
			return body(
				poly([
					[cx, b.y],
					[b.x + b.w, cy],
					[cx, b.y + b.h],
					[b.x, cy]
				])
			);
		case 'pentagon':
			return body(regular(b, 5));
		case 'hexagon':
			return body(regular(b, 6));
		case 'rounded': {
			const r = Math.min(b.w, b.h) * 0.25;
			const k = r * K;
			const x1 = b.x + b.w;
			const y1 = b.y + b.h;
			return body([
				['M', b.x + r, b.y],
				['L', x1 - r, b.y],
				['C', x1 - r + k, b.y, x1, b.y + r - k, x1, b.y + r],
				['L', x1, y1 - r],
				['C', x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1],
				['L', b.x + r, y1],
				['C', b.x + r - k, y1, b.x, y1 - r + k, b.x, y1 - r],
				['L', b.x, b.y + r],
				['C', b.x, b.y + r - k, b.x + r - k, b.y, b.x + r, b.y],
				['Z']
			]);
		}
		case 'moon':
			return body([
				['M', X(0.85), Y(0.02)],
				['C', X(0), Y(0), X(0), Y(1), X(0.85), Y(0.98)],
				['C', X(0.4), Y(0.8), X(0.4), Y(0.2), X(0.85), Y(0.02)],
				['Z']
			]);
		case 'cloud':
			return body([
				['M', X(0.22), Y(0.88)],
				['C', X(0), Y(0.88), X(0), Y(0.5), X(0.2), Y(0.5)],
				['C', X(0.2), Y(0.2), X(0.5), Y(0.1), X(0.6), Y(0.3)],
				['C', X(0.75), Y(0.15), X(1), Y(0.3), X(0.9), Y(0.55)],
				['C', X(1), Y(0.62), X(1), Y(0.88), X(0.8), Y(0.88)],
				['Z']
			]);
		case 'bolt':
			return body(
				poly([
					[X(0.62), Y(0)],
					[X(0.15), Y(0.56)],
					[X(0.46), Y(0.56)],
					[X(0.34), Y(1)],
					[X(0.85), Y(0.4)],
					[X(0.54), Y(0.4)],
					[X(0.78), Y(0)]
				])
			);
		case 'rainbow': {
			// An outer band closed by the inner arch, with one stripe between.
			const base = b.y + b.h;
			const inner = 0.5;
			const mid = 0.75;
			return [
				{
					kind: 'body',
					cmds: [
						['M', b.x, base],
						...arch(cx, base, b.w / 2, b.h),
						['L', cx + (b.w / 2) * inner, base],
						...archBack(cx, base, (b.w / 2) * inner, b.h * inner),
						['Z']
					]
				},
				{
					kind: 'line',
					cmds: [['M', cx - (b.w / 2) * mid, base], ...arch(cx, base, (b.w / 2) * mid, b.h * mid)]
				}
			];
		}
		case 'doublearrow': {
			const head = Math.min(b.w * 0.3, b.h * 0.6);
			const half = b.h * 0.18;
			return body(
				poly([
					[b.x, cy],
					[b.x + head, b.y],
					[b.x + head, cy - half],
					[b.x + b.w - head, cy - half],
					[b.x + b.w - head, b.y],
					[b.x + b.w, cy],
					[b.x + b.w - head, b.y + b.h],
					[b.x + b.w - head, cy + half],
					[b.x + head, cy + half],
					[b.x + head, b.y + b.h]
				])
			);
		}
	}
}
