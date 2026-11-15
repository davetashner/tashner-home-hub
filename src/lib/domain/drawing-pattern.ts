/**
 * Pattern fills for the paint bucket (hub-t27j.2). A fill style is "solid" or a repeating
 * pattern; the pattern is painted in the chosen color through the filled region, so it never
 * leaves the area the bucket found. Pure: `patternTile` renders one seamless RGBA tile that the
 * sheet turns into a canvas pattern. New styles (gradients, ...) join `FILL_STYLES`.
 */

export const PATTERN_IDS = ['stripes', 'dots', 'stars', 'scales', 'bricks'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** What the bucket paints: plain color, or a pattern. The picker lists these in order. */
export const FILL_STYLES = ['solid', ...PATTERN_IDS] as const;
export type FillStyle = (typeof FILL_STYLES)[number];

export const FILL_STYLE_LABELS: Record<FillStyle, string> = {
	solid: 'Solid',
	stripes: 'Stripes',
	dots: 'Dots',
	stars: 'Stars',
	scales: 'Scales',
	bricks: 'Bricks'
};

export const isPatternId = (v: unknown): v is PatternId =>
	typeof v === 'string' && (PATTERN_IDS as readonly string[]).includes(v);

/** Side of one tile in CSS px; the sheet multiplies by the device pixel ratio. */
export const PATTERN_CELL_CSS = 28;

/** The five outer and inner points of a star centred in the unit square. */
const STAR = Array.from({ length: 10 }, (_, i) => {
	const a = -Math.PI / 2 + (i * Math.PI) / 5;
	const r = i % 2 === 0 ? 0.42 : 0.18;
	return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)] as const;
});

function inStar(u: number, v: number): boolean {
	let inside = false;
	for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) {
		const [xi, yi] = STAR[i];
		const [xj, yj] = STAR[j];
		if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** True where the pattern has ink at (u, v) in the unit tile. Every pattern repeats seamlessly. */
export function patternCovers(id: PatternId, u: number, v: number): boolean {
	switch (id) {
		case 'stripes':
			return (u + v) % 1 < 0.5;
		case 'dots':
			return (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.28 ** 2;
		case 'stars':
			return inStar(u, v);
		case 'scales': {
			// Overlapping arcs, one ring around each lattice point (corners and centre).
			const centres = [
				[0, 0],
				[1, 0],
				[0, 1],
				[1, 1],
				[0.5, 0.5]
			];
			return centres.some(([cx, cy]) => Math.abs(Math.hypot(u - cx, v - cy) - 0.5) < 0.07);
		}
		case 'bricks': {
			const row = v < 0.5 ? 0 : 1;
			const seam = row === 0 ? 0 : 0.5;
			const rv = v % 0.5;
			return rv < 0.07 || (u - seam + 1) % 1 < 0.07;
		}
	}
}

/**
 * One `size` x `size` RGBA tile of the pattern in `rgb`, transparent elsewhere. Edges are
 * hard (no anti-aliasing) so a repeating tile has no visible seams.
 */
export function patternTile(
	id: PatternId,
	size: number,
	rgb: readonly [number, number, number]
): Uint8ClampedArray<ArrayBuffer> {
	const n = Math.max(1, Math.floor(size));
	const out = new Uint8ClampedArray(n * n * 4);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++)
			if (patternCovers(id, (x + 0.5) / n, (y + 0.5) / n))
				out.set([rgb[0], rgb[1], rgb[2], 255], (y * n + x) * 4);
	return out;
}
