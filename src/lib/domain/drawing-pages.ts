/**
 * Coloring pages (hub-cn7.8): original line art drawn as vector paths in a fixed 1000 x 700
 * page space, so there are no image assets and nothing to license. The sheet draws a page on a
 * layer above the paper that the eraser cannot touch, and fill treats its lines as walls.
 * Pure: path maths only.
 */
import type { PathCmd } from './drawing.js';

export const PAGE_SIZE = { w: 1000, h: 700 } as const;
export const PAGE_IDS = ['house', 'rocket', 'fish', 'garden'] as const;
export type PageId = (typeof PAGE_IDS)[number];
export const isPageId = (v: unknown): v is PageId =>
	typeof v === 'string' && (PAGE_IDS as readonly string[]).includes(v);

export const PAGE_LABELS: Record<PageId, string> = {
	house: 'House',
	rocket: 'Rocket',
	fish: 'Fish',
	garden: 'Flower garden'
};

type Path = PathCmd[];
const poly = (...pts: [number, number][]): Path => [
	['M', ...pts[0]],
	...pts.slice(1).map((p): PathCmd => ['L', ...p]),
	['Z']
];
const rect = (x: number, y: number, w: number, h: number): Path =>
	poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const circle = (x: number, y: number, r: number): Path => [['E', x, y, r, r]];
const line = (x0: number, y0: number, x1: number, y1: number): Path => [
	['M', x0, y0],
	['L', x1, y1]
];

function flower(cx: number, cy: number, k: number, stemTo: number): Path[] {
	const petals = Array.from({ length: 5 }, (_, i) => {
		const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
		return circle(cx + Math.cos(a) * 62 * k, cy + Math.sin(a) * 62 * k, 34 * k);
	});
	const leafY = cy + (stemTo - cy) * 0.55;
	return [
		...petals,
		circle(cx, cy, 30 * k),
		line(cx, cy + 96 * k, cx, stemTo),
		[
			['M', cx, leafY],
			['C', cx + 30 * k, leafY - 50 * k, cx + 90 * k, leafY - 50 * k, cx + 100 * k, leafY - 20 * k],
			['C', cx + 70 * k, leafY + 10 * k, cx + 30 * k, leafY + 10 * k, cx, leafY],
			['Z']
		]
	];
}

const PAGES: Record<PageId, Path[]> = {
	house: [
		rect(300, 300, 400, 300),
		poly([260, 300], [500, 120], [740, 300]),
		// Chimney: open at the bottom, the roof line closes it.
		[
			['M', 620, 210],
			['L', 620, 150],
			['L', 680, 150],
			['L', 680, 255]
		],
		rect(450, 420, 100, 180),
		circle(530, 515, 8),
		rect(340, 360, 80, 80),
		line(380, 360, 380, 440),
		line(340, 400, 420, 400),
		rect(580, 360, 80, 80),
		line(620, 360, 620, 440),
		line(580, 400, 660, 400),
		circle(850, 130, 55),
		line(850, 45, 850, 25),
		line(850, 215, 850, 235),
		line(765, 130, 745, 130),
		line(935, 130, 955, 130),
		rect(50, 600, 900, 60)
	],
	rocket: [
		[
			['M', 500, 80],
			['C', 580, 150, 600, 250, 600, 480],
			['L', 400, 480],
			['C', 400, 250, 420, 150, 500, 80],
			['Z']
		],
		circle(500, 270, 48),
		poly([402, 350], [290, 530], [400, 480]),
		poly([598, 350], [710, 530], [600, 480]),
		[
			['M', 430, 480],
			['C', 430, 560, 500, 620, 500, 650],
			['C', 500, 620, 570, 560, 570, 480]
		],
		circle(170, 160, 14),
		circle(830, 220, 18),
		circle(150, 480, 12),
		circle(860, 520, 14),
		circle(780, 90, 10)
	],
	fish: [
		[['E', 450, 350, 250, 150]],
		poly([695, 350], [860, 220], [860, 480]),
		circle(320, 310, 26),
		[
			['M', 215, 395],
			['C', 245, 420, 275, 420, 300, 395]
		],
		[
			['M', 400, 205],
			['C', 430, 120, 520, 120, 545, 210]
		],
		[
			['M', 500, 480],
			['C', 530, 560, 600, 560, 620, 460]
		],
		[
			['M', 440, 280],
			['C', 470, 310, 470, 390, 440, 420]
		],
		[
			['M', 530, 270],
			['C', 560, 310, 560, 390, 530, 430]
		],
		circle(160, 190, 28),
		circle(110, 280, 18),
		circle(210, 110, 14),
		[
			['M', 800, 650],
			['C', 740, 600, 860, 560, 800, 500]
		],
		[
			['M', 880, 650],
			['C', 820, 600, 940, 560, 880, 520]
		]
	],
	garden: [
		...flower(250, 280, 1.2, 600),
		...flower(520, 360, 1, 600),
		...flower(780, 260, 1.3, 600),
		circle(110, 100, 45),
		line(110, 30, 110, 12),
		line(180, 100, 198, 100),
		line(110, 170, 110, 188),
		rect(50, 600, 900, 60)
	]
};

export const pageDrawing = (id: PageId): Path[] => PAGES[id];

export interface Fit {
	/** Scale from page space to canvas CSS pixels. */
	s: number;
	ox: number;
	oy: number;
}

/** The page fitted to a canvas: uniform scale, centred, never distorted. */
export function pageFit(canvas: { w: number; h: number }): Fit {
	const s = Math.min(canvas.w / PAGE_SIZE.w, canvas.h / PAGE_SIZE.h);
	return { s, ox: (canvas.w - PAGE_SIZE.w * s) / 2, oy: (canvas.h - PAGE_SIZE.h * s) / 2 };
}

/** The page's paths in canvas CSS pixels. */
export function pagePaths(id: PageId, canvas: { w: number; h: number }): Path[] {
	const { s, ox, oy } = pageFit(canvas);
	const X = (x: number) => x * s + ox;
	const Y = (y: number) => y * s + oy;
	return PAGES[id].map((p) =>
		p.map((c): PathCmd => {
			switch (c[0]) {
				case 'M':
				case 'L':
					return [c[0], X(c[1]), Y(c[2])];
				case 'C':
					return ['C', X(c[1]), Y(c[2]), X(c[3]), Y(c[4]), X(c[5]), Y(c[6])];
				case 'E':
					return ['E', X(c[1]), Y(c[2]), c[3] * s, c[4] * s];
				default:
					return c;
			}
		})
	);
}

/** Outline width in CSS px for a page drawn at scale `s`: bold enough to read and to hold a fill. */
export const pageLineWidth = (s: number): number => Math.max(3, Math.round(6 * s));
