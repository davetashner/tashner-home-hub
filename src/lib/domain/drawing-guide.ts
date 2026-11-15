// hub-t27j.12: "How to draw" guides. A guide is a list of steps; each step adds a few faint lines
// to trace. The lines are a screen overlay, never ink: they are not erased, saved or posted. The art
// itself (drawing-guide-art.ts) is a separate lazy chunk; this module is the small, eager part.
import type { PathCmd } from './drawing.js';

export const GUIDE_IDS = ['cat', 'dog', 'house', 'car', 'flower', 'fish'] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export const GUIDE_LABELS: Readonly<Record<GuideId, string>> = {
	cat: 'Cat',
	dog: 'Dog',
	house: 'House',
	car: 'Car',
	flower: 'Flower',
	fish: 'Fish'
};

export const isGuideId = (v: unknown): v is GuideId =>
	typeof v === 'string' && (GUIDE_IDS as readonly string[]).includes(v);

/** A step index kept inside 0..count-1 (0 when there are no steps or the input is not a number). */
export function clampStep(step: number, count: number): number {
	if (!Number.isFinite(step) || count < 1) return 0;
	return Math.min(count - 1, Math.max(0, Math.trunc(step)));
}

export const nextStep = (step: number, count: number): number => clampStep(step + 1, count);
export const prevStep = (step: number, count: number): number => clampStep(step - 1, count);
export const isLastStep = (step: number, count: number): boolean => step >= count - 1;

/** "Step 2 of 5", one-based for kids. */
export const stepLabel = (step: number, count: number): string =>
	`Step ${clampStep(step, count) + 1} of ${Math.max(1, count)}`;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** An SVG path `d` for a page-space path (ellipses become two arcs). */
export function pathD(path: readonly PathCmd[]): string {
	return path
		.map((c) => {
			switch (c[0]) {
				case 'M':
				case 'L':
					return `${c[0]}${r1(c[1])} ${r1(c[2])}`;
				case 'C':
					return `C${[c[1], c[2], c[3], c[4], c[5], c[6]].map(r1).join(' ')}`;
				case 'E': {
					const [, x, y, rx, ry] = c;
					return `M${r1(x - rx)} ${r1(y)}a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(2 * rx)} 0a${r1(rx)} ${r1(ry)} 0 1 0 ${r1(-2 * rx)} 0`;
				}
				default:
					return 'Z';
			}
		})
		.join('');
}

export interface GuideLayer {
	d: string;
	/** True for the step being traced now; earlier steps are shown fainter. */
	current: boolean;
}

/** One layer per step up to and including `step`, so earlier steps stay faintly visible. */
export function guideLayers(
	steps: readonly (readonly (readonly PathCmd[])[])[],
	step: number
): GuideLayer[] {
	if (!steps.length) return [];
	const at = clampStep(step, steps.length);
	return steps.slice(0, at + 1).map((paths, i) => ({
		d: paths.map(pathD).join(''),
		current: i === at
	}));
}
