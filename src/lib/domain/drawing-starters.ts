/**
 * Prompt starters (hub-585): a half-done sketch for some daily prompts, so a kid who does not know
 * where to begin gets the scene started and draws the rest (the bus, not the dog driving it).
 * Original line art as vector paths in the coloring pages' 1000 x 700 page space; the sheet puts
 * it on the board as ordinary black pen strokes, so it can be erased and one Undo takes it back.
 * Pure: path maths only.
 */
import { FIXED_WIDTH, type PathCmd, type Stroke } from './drawing.js';
import { pageFit } from './drawing-pages.js';

type Path = PathCmd[];
type Pt = [number, number];

/** An open line through the points. */
const open = (...pts: Pt[]): Path => [
	['M', ...pts[0]],
	...pts.slice(1).map((p): PathCmd => ['L', ...p])
];
/** A closed outline through the points. */
const poly = (...pts: Pt[]): Path => [...open(...pts), ['Z']];
const rect = (x: number, y: number, w: number, h: number): Path =>
	poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const oval = (x: number, y: number, rx: number, ry: number): Path => [['E', x, y, rx, ry]];
const circle = (x: number, y: number, r: number): Path => oval(x, y, r, r);
/** A smooth hump from (x0, y) to (x1, y) peaking `rise` above it. */
const hump = (x0: number, x1: number, y: number, rise: number): Path => [
	['M', x0, y],
	['C', x0 + (x1 - x0) * 0.2, y - rise * 1.3, x1 - (x1 - x0) * 0.2, y - rise * 1.3, x1, y]
];

/** Starters keyed by the exact prompt text in DRAWING_PROMPTS. Each leaves the subject to draw. */
const STARTERS: Readonly<Record<string, readonly Path[]>> = {
	// The bus and its wheels; the driver's seat is empty.
	'Draw a dog driving a bus': [
		rect(180, 260, 640, 260),
		rect(220, 300, 110, 90),
		rect(360, 300, 110, 90),
		rect(500, 300, 110, 90),
		rect(660, 300, 120, 120),
		open([180, 450], [820, 450]),
		circle(320, 540, 55),
		circle(680, 540, 55)
	],
	// A house with balloon strings rising from the roof; no balloons yet.
	'Draw a flying house with balloons': [
		rect(370, 440, 260, 200),
		poly([340, 440], [500, 330], [660, 440]),
		rect(470, 540, 60, 100),
		open([500, 330], [420, 120]),
		open([500, 330], [500, 90]),
		open([500, 330], [590, 130])
	],
	// Three upside-down cones for towers; the scoops are up to you.
	'Draw a castle made of ice cream': [
		poly([220, 360], [340, 360], [280, 600]),
		poly([440, 300], [560, 300], [500, 600]),
		poly([660, 360], [780, 360], [720, 600]),
		open([160, 600], [840, 600])
	],
	// The skateboard, waiting for its penguin.
	'Draw a penguin on a skateboard': [
		[
			['M', 280, 520],
			['L', 720, 520],
			['C', 760, 520, 770, 490, 790, 480],
			['M', 280, 520],
			['C', 240, 520, 230, 490, 210, 480]
		],
		circle(360, 560, 30),
		circle(640, 560, 30)
	],
	// The island and the tower; add the light, the sun and the sea.
	'Draw a lighthouse on a sunny island': [
		hump(250, 750, 600, 90),
		poly([450, 520], [550, 520], [530, 220], [470, 220]),
		rect(455, 170, 90, 50),
		open([0, 620], [250, 620]),
		open([750, 620], [1000, 620])
	],
	// Mountains and a basket hanging in the sky; the balloon is missing.
	'Draw a hot air balloon over a mountain': [
		open([0, 650], [200, 430], [330, 560], [520, 330], [720, 580], [850, 460], [1000, 600]),
		rect(450, 170, 100, 60),
		open([460, 170], [425, 90]),
		open([540, 170], [575, 90])
	],
	// A very tall hat; who is wearing it?
	'Draw a giraffe in a very tall hat': [
		open([440, 252], [440, 40], [560, 40], [560, 252]),
		oval(500, 260, 120, 22)
	],
	// Hull and mast; add the sails and the lemonade sea.
	'Draw a pirate ship sailing on lemonade': [
		poly([220, 420], [780, 420], [700, 540], [300, 540]),
		open([500, 420], [500, 120]),
		open([500, 120], [560, 140], [500, 160])
	],
	// The bicycle; the koala rides it.
	'Draw a koala on a bicycle': [
		circle(300, 500, 110),
		circle(700, 500, 110),
		open([300, 500], [450, 500], [620, 360], [420, 360], [300, 500]),
		open([450, 500], [400, 330]),
		open([360, 330], [440, 330]),
		open([700, 500], [620, 360], [600, 300], [660, 290])
	],
	// The snowman's body; give it a summer day.
	'Draw a snowman enjoying a summer day': [
		circle(500, 540, 120),
		circle(500, 340, 90),
		circle(500, 190, 65)
	],
	// A big tree trunk with its branches; the magic door is yours to draw.
	'Draw a magic door in a tree trunk': [
		open([400, 680], [420, 330], [300, 180]),
		open([600, 680], [580, 330], [700, 170]),
		open([330, 680], [670, 680])
	],
	// The cabin; the snowy forest grows around it.
	'Draw a cozy cabin in a snowy forest': [
		rect(360, 400, 280, 200),
		poly([330, 400], [500, 270], [670, 400]),
		// Chimney: open at the bottom, the roof line closes it.
		open([570, 324], [570, 280], [610, 280], [610, 354]),
		rect(470, 500, 60, 100),
		rect(390, 440, 60, 50)
	],
	// The submarine; the coral reef is all around.
	'Draw a submarine exploring a coral reef': [
		oval(500, 330, 230, 90),
		rect(450, 190, 90, 60),
		open([500, 190], [500, 130], [550, 130]),
		poly([270, 330], [220, 280], [220, 380])
	],
	// A plate and the first pancakes; keep stacking until it is as tall as a house.
	'Draw a pancake stack as tall as a house': [
		oval(500, 645, 260, 26),
		oval(500, 596, 200, 20),
		oval(500, 552, 200, 20),
		oval(500, 508, 200, 20)
	],
	// The engine on its track; the carriages and clouds come next.
	'Draw a train that travels through the clouds': [
		rect(560, 300, 140, 160),
		rect(320, 360, 240, 100),
		rect(360, 290, 50, 70),
		circle(390, 490, 35),
		circle(500, 490, 35),
		circle(630, 490, 35),
		open([100, 530], [900, 530])
	]
};

/** The prompts the sketches cover (must match STARTER_PROMPTS in drawing-starter-names.ts). */
export const SKETCHED_PROMPTS: readonly string[] = Object.keys(STARTERS);

/** The starter's paths in page space, or null when the prompt has none. */
export const starterPaths = (prompt: string): readonly Path[] | null =>
	Object.hasOwn(STARTERS, prompt) ? STARTERS[prompt] : null;

const CURVE_STEPS = 16;
const ELLIPSE_STEPS = 40;

/** Turns a path into point runs, one per subpath: curves and ellipses become short lines. */
export function flattenPath(path: Path): Pt[][] {
	const out: Pt[][] = [];
	let run: Pt[] = [];
	const end = () => {
		if (run.length > 1) out.push(run);
		run = [];
	};
	for (const cmd of path) {
		const last = run[run.length - 1];
		switch (cmd[0]) {
			case 'M':
				end();
				run.push([cmd[1], cmd[2]]);
				break;
			case 'L':
				run.push([cmd[1], cmd[2]]);
				break;
			case 'C': {
				if (!last) break;
				const [, x1, y1, x2, y2, x, y] = cmd;
				for (let i = 1; i <= CURVE_STEPS; i++) {
					const t = i / CURVE_STEPS;
					const u = 1 - t;
					run.push([
						u * u * u * last[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
						u * u * u * last[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
					]);
				}
				break;
			}
			case 'E': {
				end();
				const [, cx, cy, rx, ry] = cmd;
				for (let i = 0; i <= ELLIPSE_STEPS; i++) {
					const a = (i / ELLIPSE_STEPS) * Math.PI * 2;
					run.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
				}
				end();
				break;
			}
			case 'Z':
				if (run.length > 1) run.push(run[0]);
				end();
				break;
		}
	}
	end();
	return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The prompt's starter as black pen strokes fitted to a canvas of `canvas` CSS px, the way a
 * coloring page is fitted. Empty when the prompt has no starter.
 */
export function starterStrokes(prompt: string, canvas: { w: number; h: number }): Stroke[] {
	const paths = starterPaths(prompt);
	if (!paths) return [];
	const fit = pageFit(canvas);
	return paths.flatMap(flattenPath).map((run) => ({
		tool: 'pen',
		color: 'draw-black',
		points: run.map(([x, y]) => ({
			x: r1(fit.ox + x * fit.s),
			y: r1(fit.oy + y * fit.s),
			w: FIXED_WIDTH
		}))
	}));
}
