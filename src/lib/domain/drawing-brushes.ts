/**
 * Textured brushes (hub-cn7.19): crayon, chalk, watercolor and spray paint. A small registry so
 * later pens (glitter, rainbow) plug in the same way. Texture is a pure function of the stroke's
 * `seed`, the segment index and the points, so redraw, undo, refit and reopening a saved drawing
 * all paint the same grain. Pure: painting lives in the sheet's brush painter.
 */

export const BRUSH_TOOLS = [
	'crayon',
	'chalk',
	'watercolor',
	'spray',
	'glitter',
	'rainbow'
] as const;
export type BrushTool = (typeof BRUSH_TOOLS)[number];
export const isBrushTool = (t: string): t is BrushTool =>
	(BRUSH_TOOLS as readonly string[]).includes(t);

export interface BrushSpec {
	label: string;
	/** `dots`: grain stamped along each segment as it is drawn. `wash`: a whole translucent path. */
	kind: 'dots' | 'wash' | 'glitter' | 'rainbow';
	/** Multiplier on the pen's base width. */
	widthScale: number;
	/** Grain per square CSS px of brush footprint (dots brushes). */
	density: number;
	/** Dot edge in CSS px: [min, max]. */
	dot: readonly [number, number];
	/** Chance a dot is dropped, so the paper shows through. */
	gap: number;
	/** Canvas alpha for each dot level (0 faint, 1 solid). */
	levels: readonly [number, number];
	/** Dots spread by a bell curve (spray) instead of evenly across the width. */
	soft: boolean;
}

export const BRUSHES: Record<BrushTool, BrushSpec> = {
	crayon: {
		label: 'Crayon',
		kind: 'dots',
		widthScale: 1.6,
		density: 0.9,
		dot: [1.5, 2.6],
		gap: 0.22,
		levels: [0.55, 0.95],
		soft: false
	},
	chalk: {
		label: 'Chalk',
		kind: 'dots',
		widthScale: 1.9,
		density: 0.5,
		dot: [1, 2.2],
		gap: 0.4,
		levels: [0.35, 0.75],
		soft: false
	},
	watercolor: {
		label: 'Watercolor',
		kind: 'wash',
		widthScale: 3,
		density: 0,
		dot: [0, 0],
		gap: 0,
		levels: [0.2, 0.2],
		soft: false
	},
	spray: {
		label: 'Spray paint',
		kind: 'dots',
		widthScale: 4,
		density: 0.16,
		dot: [1, 1.8],
		gap: 0.05,
		levels: [0.45, 0.9],
		soft: true
	},
	// Glitter: the ink color as a solid line, plus sparkles from `glitterSparkles` (density per px^2).
	glitter: {
		label: 'Glitter',
		kind: 'glitter',
		widthScale: 1.8,
		density: 0.03,
		dot: [1.2, 2.6],
		gap: 0,
		levels: [1, 1],
		soft: false
	},
	// Rainbow: ignores the ink color; hue starts at red and cycles every RAINBOW_PERIOD px of stroke.
	rainbow: {
		label: 'Rainbow',
		kind: 'rainbow',
		widthScale: 1.6,
		density: 0,
		dot: [0, 0],
		gap: 0,
		levels: [1, 1],
		soft: false
	}
};

/** Fixed-seed hash to a 32-bit state: mixes a stroke seed with a segment index. */
export function hashSeed(seed: number, i: number): number {
	let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: a tiny seeded generator returning floats in [0, 1). */
export function seededRandom(state: number): () => number {
	let a = state >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Tools whose strokes honor the opacity setting (hub-cn7.13): the pen, and textured brushes multiply it into their own alpha. */
export const isAlphaTool = (t: string): boolean => t === 'pen' || isBrushTool(t);

/** A fresh seed for a new stroke. */
export const newSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** Seeds from saved drawings: an integer in range, else 0 (strokes saved without one). */
export const isSeed = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0x7fffffff;

/** Most dots one segment may stamp, so a fast fling on the 4K board stays one cheap frame. */
export const MAX_DOTS_PER_SEGMENT = 160;

/**
 * Grain for the segment ending at point `i`: a flat list of `[x, y, size, level]` quadruples
 * (level 0 or 1 picks the alpha), scattered across the brush width around the segment.
 * Deterministic in (seed, i, from, to, width).
 */
export function segmentDots(
	spec: BrushSpec,
	seed: number,
	i: number,
	from: { x: number; y: number },
	to: { x: number; y: number },
	width: number
): number[] {
	const rand = seededRandom(hashSeed(seed, i));
	const len = Math.hypot(to.x - from.x, to.y - from.y);
	const half = width / 2;
	// Footprint of the segment: its length plus a round cap, times the width.
	const area = (len + width * 0.5) * width;
	const count = Math.min(MAX_DOTS_PER_SEGMENT, Math.max(1, Math.round(area * spec.density)));
	const out: number[] = [];
	for (let n = 0; n < count; n++) {
		const t = rand();
		const along = rand();
		const keep = rand();
		const size = spec.dot[0] + rand() * (spec.dot[1] - spec.dot[0]);
		const lvl = rand() < 0.5 ? 0 : 1;
		if (keep < spec.gap) continue;
		// Bell curve for soft brushes (sum of uniforms), even spread otherwise.
		const spread = spec.soft ? (rand() + rand() + rand() - 1.5) / 1.5 : t * 2 - 1;
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const nx = len > 0 ? -dy / len : 0;
		const ny = len > 0 ? dx / len : 1;
		const off = spread * half;
		out.push(from.x + dx * along + nx * off, from.y + dy * along + ny * off, size, lvl);
	}
	return out;
}

/** The translucent passes of a watercolor wash: a wide base, then two offset, narrower blooms. */
export function washPasses(
	seed: number,
	width: number
): { dx: number; dy: number; width: number; alpha: number }[] {
	const rand = seededRandom(hashSeed(seed, 0));
	const wobble = width * 0.12;
	return [
		{ dx: 0, dy: 0, width, alpha: 0.22 },
		{ dx: (rand() - 0.5) * wobble, dy: (rand() - 0.5) * wobble, width: width * 0.72, alpha: 0.18 },
		{ dx: (rand() - 0.5) * wobble, dy: (rand() - 0.5) * wobble, width: width * 0.4, alpha: 0.14 }
	];
}

/** Stroke length in CSS px for one full trip round the hue wheel. */
export const RAINBOW_PERIOD = 420;

/** Hue (degrees) a rainbow stroke has `along` px from its start: depends only on length, never on speed. */
export const rainbowHue = (along: number): number =>
	((((along / RAINBOW_PERIOD) * 360) % 360) + 360) % 360;

/** Most sparkles one glitter segment may add. */
export const MAX_SPARKLES_PER_SEGMENT = 24;

/**
 * Sparkles for the glitter segment ending at point `i`: flat `[x, y, size, kind]` quadruples.
 * Kind 0 is a small bright dot, 1 a dot in the ink color, 2 a star glint (a larger four-point star).
 * Deterministic in (seed, i, from, to, width).
 */
export function glitterSparkles(
	spec: BrushSpec,
	seed: number,
	i: number,
	from: { x: number; y: number },
	to: { x: number; y: number },
	width: number
): number[] {
	const rand = seededRandom(hashSeed(seed, i));
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy);
	const nx = len > 0 ? -dy / len : 0;
	const ny = len > 0 ? dx / len : 1;
	// Expected sparkles for the segment's area, rounded up or down by chance so short segments still add up.
	// A lone point (the stroke's first) gets its round cap's worth.
	const area = (len > 0 ? len : width * 0.5) * width;
	const count = Math.min(MAX_SPARKLES_PER_SEGMENT, Math.floor(area * spec.density + rand()));
	const out: number[] = [];
	for (let n = 0; n < count; n++) {
		const along = rand();
		const off = (rand() * 2 - 1) * (width * 0.4);
		const size = spec.dot[0] + rand() * (spec.dot[1] - spec.dot[0]);
		const r = rand();
		const kind = r < 0.12 ? 2 : r < 0.55 ? 0 : 1;
		out.push(
			from.x + dx * along + nx * off,
			from.y + dy * along + ny * off,
			kind === 2 ? width * 0.25 + size : size,
			kind
		);
	}
	return out;
}
