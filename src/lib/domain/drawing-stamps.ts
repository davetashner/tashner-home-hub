/** Original outline stamps (hub-cn7.5): a speech bubble and four animals as vector paths in a unit box. */
import type { PathCmd, ShapeKind, ShapePart } from './drawing.js';

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

type Pts = number[];

export function stampParts(kind: ShapeKind, b: Box): ShapePart[] {
	const X = (f: number) => b.x + b.w * f;
	const Y = (f: number) => b.y + b.h * f;
	/** Path from unit-box commands: M/L take 2 numbers, C takes 6, Z none. */
	const path = (...segs: (['M' | 'L', ...Pts] | ['C', ...Pts] | ['Z'])[]): PathCmd[] =>
		segs.map((s): PathCmd => {
			if (s[0] === 'Z') return ['Z'];
			if (s[0] === 'C') return ['C', X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6])];
			return [s[0], X(s[1]), Y(s[2])];
		});
	const ell = (cx: number, cy: number, rx: number, ry: number): PathCmd => [
		'E',
		X(cx),
		Y(cy),
		b.w * rx,
		b.h * ry
	];
	const seg = (x0: number, y0: number, x1: number, y1: number): PathCmd[] =>
		path(['M', x0, y0], ['L', x1, y1]);
	const dot = (cx: number, cy: number, r: number): ShapePart => ({
		kind: 'solid',
		cmds: [ell(cx, cy, r, r)]
	});

	switch (kind) {
		case 'bubble':
			return [
				{
					kind: 'body',
					cmds: path(
						['M', 0.18, 0],
						['L', 0.82, 0],
						['C', 1, 0, 1, 0, 1, 0.18],
						['L', 1, 0.5],
						['C', 1, 0.68, 1, 0.68, 0.82, 0.68],
						['L', 0.45, 0.68],
						['L', 0.2, 1],
						['L', 0.25, 0.68],
						['L', 0.18, 0.68],
						['C', 0, 0.68, 0, 0.68, 0, 0.5],
						['L', 0, 0.18],
						['C', 0, 0, 0, 0, 0.18, 0],
						['Z']
					)
				},
				{ kind: 'line', cmds: [...seg(0.2, 0.22, 0.8, 0.22), ...seg(0.2, 0.44, 0.6, 0.44)] }
			];
		case 'cat':
			return [
				{
					kind: 'body',
					cmds: path(
						['M', 0.1, 0.08],
						['L', 0.36, 0.22],
						['C', 0.46, 0.19, 0.54, 0.19, 0.64, 0.22],
						['L', 0.9, 0.08],
						['L', 0.92, 0.55],
						['C', 0.92, 0.85, 0.72, 0.98, 0.5, 0.98],
						['C', 0.28, 0.98, 0.08, 0.85, 0.08, 0.55],
						['Z']
					)
				},
				dot(0.35, 0.55, 0.06),
				dot(0.65, 0.55, 0.06),
				dot(0.5, 0.68, 0.04),
				{
					kind: 'line',
					cmds: [
						...seg(0.04, 0.66, 0.26, 0.72),
						...seg(0.04, 0.8, 0.26, 0.76),
						...seg(0.96, 0.66, 0.74, 0.72),
						...seg(0.96, 0.8, 0.74, 0.76)
					]
				}
			];
		case 'dog':
			return [
				{ kind: 'body', cmds: [ell(0.5, 0.5, 0.28, 0.4)] },
				{ kind: 'body', cmds: [ell(0.12, 0.42, 0.1, 0.26)] },
				{ kind: 'body', cmds: [ell(0.88, 0.42, 0.1, 0.26)] },
				dot(0.4, 0.38, 0.04),
				dot(0.6, 0.38, 0.04),
				dot(0.5, 0.6, 0.07),
				{
					kind: 'line',
					cmds: path(['M', 0.5, 0.64], ['L', 0.5, 0.72], ['C', 0.44, 0.82, 0.38, 0.8, 0.36, 0.75])
				}
			];
		case 'fish':
			return [
				{ kind: 'body', cmds: [ell(0.4, 0.5, 0.38, 0.3)] },
				{
					kind: 'body',
					cmds: path(['M', 0.76, 0.5], ['L', 1, 0.2], ['L', 1, 0.8], ['Z'])
				},
				dot(0.2, 0.44, 0.04),
				{
					kind: 'line',
					cmds: path(['M', 0.32, 0.34], ['C', 0.38, 0.45, 0.38, 0.55, 0.32, 0.66])
				}
			];
		case 'bird':
			return [
				{ kind: 'body', cmds: [ell(0.42, 0.62, 0.36, 0.28)] },
				{ kind: 'body', cmds: [ell(0.72, 0.28, 0.18, 0.18)] },
				{
					kind: 'body',
					cmds: path(['M', 0.88, 0.24], ['L', 1, 0.3], ['L', 0.88, 0.36], ['Z'])
				},
				dot(0.75, 0.25, 0.03),
				{
					kind: 'line',
					cmds: [
						...path(['M', 0.28, 0.6], ['C', 0.4, 0.42, 0.58, 0.52, 0.52, 0.74]),
						...seg(0.08, 0.55, 0, 0.4),
						...seg(0.4, 0.9, 0.4, 1),
						...seg(0.56, 0.88, 0.56, 1)
					]
				}
			];
		default:
			return [];
	}
}
