/**
 * Prompt starters, batch C (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-c.ts too.
 */
import { circle, hump, open, oval, poly, rect, type Path } from './shapes.js';

/** A wavy line from x0 to x1 at height y, `n` waves of height `h`. */
const wave = (x0: number, x1: number, y: number, n = 4, h = 18): Path => {
	const step = (x1 - x0) / n;
	const cmds: Path = [['M', x0, y]];
	for (let i = 0; i < n; i++) {
		const a = x0 + step * i;
		cmds.push(['C', a + step * 0.25, y - h, a + step * 0.75, y + h, a + step, y]);
	}
	return cmds;
};
/** A leaf-shaped outline from (x0, y0) to (x1, y1), bulging by `b`. */
const leaf = (x0: number, y0: number, x1: number, y1: number, b: number): Path => {
	const mx = (x0 + x1) / 2;
	const my = (y0 + y1) / 2;
	return [
		['M', x0, y0],
		['C', mx - b, my - b, mx - b, my - b, x1, y1],
		['C', mx + b, my + b, mx + b, my + b, x0, y0],
		['Z']
	];
};
/** A crescent moon centred at (cx, cy). */
const crescent = (cx: number, cy: number, r: number): Path => [
	['M', cx + r * 0.3, cy - r],
	['C', cx - r * 1.4, cy - r * 0.8, cx - r * 1.4, cy + r * 0.8, cx + r * 0.3, cy + r],
	['C', cx - r * 0.5, cy + r * 0.5, cx - r * 0.5, cy - r * 0.5, cx + r * 0.3, cy - r],
	['Z']
];
/** A little four-point star. */
const star = (cx: number, cy: number, r: number): Path =>
	open([cx, cy - r], [cx, cy + r]).concat(open([cx - r, cy], [cx + r, cy]));
/** Grass blades along a line. */
const grass = (xs: number[], y: number, h = 40): Path[] =>
	xs.map((x) => open([x - 10, y], [x, y - h], [x + 10, y]));

export const SET_C: Readonly<Record<string, readonly Path[]>> = {
	// A beach line, waves and one lonely tower; the rest of the sandcastle city is yours.
	'Draw a sandcastle city on the beach': [
		open([0, 560], [1000, 560]),
		wave(0, 1000, 120, 6, 16),
		poly(
			[120, 560],
			[120, 400],
			[150, 400],
			[150, 420],
			[180, 420],
			[180, 400],
			[210, 400],
			[210, 560]
		),
		[
			['M', 150, 560],
			['L', 150, 510],
			['C', 150, 480, 180, 480, 180, 510],
			['L', 180, 560]
		],
		open([300, 650], [900, 650])
	],
	// The bridge and the river under it; no ducks yet.
	'Draw a family of ducks crossing a bridge': [
		[
			['M', 150, 400],
			['C', 300, 250, 700, 250, 850, 400]
		],
		[
			['M', 150, 440],
			['C', 300, 290, 700, 290, 850, 440]
		],
		open([150, 400], [150, 440]),
		open([850, 400], [850, 440]),
		wave(0, 1000, 560, 6, 14),
		wave(0, 1000, 630, 6, 14)
	],
	// A hill with a stone tower and some stars; the wizard and his glitter are missing.
	'Draw a wizard who casts spells with glitter': [
		hump(0, 1000, 620, 90),
		rect(780, 330, 90, 220),
		poly([770, 330], [825, 250], [880, 330]),
		rect(810, 400, 30, 50),
		star(150, 120, 25),
		star(420, 70, 20),
		star(650, 150, 28),
		crescent(900, 100, 40)
	],
	// The shop front, awning and a round pizza sign; the raccoon is not at the counter yet.
	'Draw a raccoon opening a pizza shop': [
		rect(150, 250, 700, 380),
		poly([120, 250], [180, 170], [820, 170], [880, 250]),
		open([300, 170], [280, 250]),
		open([500, 170], [500, 250]),
		open([700, 170], [720, 250]),
		rect(610, 320, 180, 130),
		rect(250, 330, 260, 300),
		circle(500, 100, 50)
	],
	// A zoo gate, a fence and a path leading to a house; the animals and visitors are yours.
	'Draw a zoo where the animals visit people': [
		open([100, 600], [100, 300]),
		open([300, 600], [300, 300]),
		[
			['M', 100, 300],
			['C', 120, 190, 280, 190, 300, 300]
		],
		open([0, 560], [100, 560]),
		open([0, 500], [100, 500]),
		rect(650, 350, 220, 200),
		poly([630, 350], [760, 250], [890, 350]),
		rect(730, 450, 60, 100),
		open([300, 640], [700, 640], [730, 550])
	],
	// Two trees and a hammock slung between them; the sloth is not in it.
	'Draw a sleepy sloth in a hammock': [
		poly([130, 700], [150, 200], [220, 200], [240, 700]),
		poly([760, 700], [780, 200], [850, 200], [870, 700]),
		[
			['M', 220, 380],
			['C', 340, 560, 660, 560, 780, 380]
		],
		[
			['M', 220, 400],
			['C', 340, 600, 660, 600, 780, 400]
		],
		hump(100, 400, 200, 90),
		hump(600, 900, 200, 90)
	],
	// The rails and the wheels; the animal train cars are for you.
	'Draw a train made of animals': [
		open([0, 560], [1000, 560]),
		open([0, 600], [1000, 600]),
		...[80, 240, 400, 560, 720, 880].map((x) => open([x, 560], [x, 600])),
		circle(200, 500, 45),
		circle(500, 500, 45),
		circle(800, 500, 45),
		open([100, 455], [900, 455])
	],
	// A grass line, a flag bunting and a mushroom; the ladybug and her parade are yours.
	'Draw a ladybug throwing a tiny parade': [
		open([0, 580], [1000, 580]),
		[
			['M', 100, 150],
			['C', 300, 260, 700, 260, 900, 150]
		],
		poly([200, 210], [250, 215], [225, 270]),
		poly([420, 235], [470, 237], [445, 292]),
		poly([620, 235], [670, 233], [645, 290]),
		poly([800, 210], [850, 200], [825, 260]),
		...grass([80, 150, 900, 950], 580),
		[
			['M', 780, 580],
			['C', 770, 500, 880, 500, 870, 580]
		],
		open([825, 580], [825, 640])
	],
	// A city skyline and a rooftop; the superhero friend is missing.
	'Draw your best friend as a superhero': [
		poly([0, 620], [0, 380], [140, 380], [140, 620]),
		poly([140, 620], [140, 300], [280, 300], [280, 620]),
		poly([700, 620], [700, 360], [840, 360], [840, 620]),
		poly([840, 620], [840, 250], [1000, 250], [1000, 620]),
		open([0, 620], [1000, 620]),
		rect(200, 340, 30, 30),
		rect(900, 300, 30, 30),
		circle(500, 110, 50)
	],
	// The kick scooter and the ground it rolls on; the dinosaur rider is up to you.
	'Draw a dinosaur learning to ride a scooter': [
		open([0, 600], [1000, 600]),
		open([300, 540], [700, 540]),
		circle(280, 560, 40),
		circle(720, 560, 40),
		open([700, 540], [740, 200]),
		open([690, 200], [790, 200])
	],
	// A fence and stems with leaves, but no flowers yet.
	'Draw a garden full of giant flowers': [
		open([0, 600], [1000, 600]),
		open([200, 600], [200, 280]),
		open([480, 600], [480, 180]),
		open([780, 600], [780, 300]),
		leaf(200, 480, 120, 410, 20),
		leaf(480, 440, 580, 360, 25),
		leaf(780, 500, 700, 430, 20),
		open([0, 640], [1000, 640])
	],
	// Wavy strands of seaweed and bubbles; the seahorse and its race are missing.
	'Draw a seahorse racing through seaweed': [
		[
			['M', 120, 640],
			['C', 60, 540, 180, 440, 120, 340],
			['C', 80, 280, 150, 220, 120, 160]
		],
		[
			['M', 360, 640],
			['C', 300, 540, 420, 440, 360, 340]
		],
		[
			['M', 640, 640],
			['C', 580, 520, 700, 420, 640, 300],
			['C', 600, 240, 680, 180, 640, 120]
		],
		[
			['M', 880, 640],
			['C', 820, 540, 940, 440, 880, 330]
		],
		circle(500, 200, 20),
		circle(540, 150, 12),
		circle(250, 140, 15),
		hump(0, 1000, 660, 20)
	],
	// A car shell on a winding road with hills ahead; the family is not inside yet.
	'Draw a family on a road trip to somewhere wonderful': [
		poly([0, 420], [180, 270], [320, 370], [480, 230], [680, 400], [820, 300], [1000, 420]),
		[
			['M', 300, 700],
			['C', 400, 600, 600, 560, 520, 470],
			['L', 480, 470],
			['C', 400, 560, 200, 600, 100, 700]
		],
		poly(
			[560, 640],
			[560, 570],
			[640, 570],
			[680, 520],
			[800, 520],
			[850, 570],
			[900, 570],
			[900, 640]
		),
		circle(630, 645, 30),
		circle(830, 645, 30),
		circle(850, 120, 45)
	],
	// A teacup and its saucer; the tiny dragon inside is yours.
	'Draw a tiny dragon living in a teacup': [
		[
			['M', 250, 330],
			['L', 750, 330],
			['C', 750, 560, 250, 560, 250, 330]
		],
		oval(500, 330, 250, 40),
		[
			['M', 750, 380],
			['C', 880, 360, 880, 500, 720, 490]
		],
		oval(500, 590, 340, 50)
	],
	// A stove with a big pot and a chef's counter; the gentle lion cook is missing.
	'Draw a lion who is a gentle chef': [
		rect(100, 450, 800, 200),
		rect(620, 330, 180, 120),
		oval(710, 330, 90, 22),
		open([180, 450], [180, 650]),
		open([100, 520], [900, 520]),
		open([150, 120], [150, 200]),
		circle(150, 250, 50),
		open([300, 120], [300, 200]),
		circle(300, 250, 50)
	],
	// A rolling horizon and clouds; the sun and the moon are for you.
	'Draw a sun and moon sharing a sky': [
		hump(0, 500, 600, 80),
		hump(500, 1000, 600, 100),
		open([0, 600], [1000, 600]),
		[
			['M', 100, 200],
			['C', 80, 150, 160, 130, 190, 170],
			['C', 220, 120, 290, 150, 280, 200],
			['Z']
		],
		[
			['M', 700, 220],
			['C', 680, 170, 760, 150, 790, 190],
			['C', 820, 140, 890, 170, 880, 220],
			['Z']
		]
	],
	// A school with a flag, a tree and a path; the squirrel is yours.
	'Draw a squirrel with a backpack going to school': [
		rect(480, 300, 420, 250),
		poly([460, 300], [690, 200], [920, 300]),
		rect(650, 440, 80, 110),
		rect(520, 350, 70, 70),
		rect(800, 350, 70, 70),
		open([690, 200], [690, 120]),
		poly([690, 120], [750, 140], [690, 160]),
		poly([140, 600], [160, 400], [220, 400], [240, 600]),
		circle(190, 330, 90),
		open([0, 600], [1000, 600])
	],
	// The planet's curved ground, a slide and a swing frame; the kids are yours.
	'Draw a playground on another planet': [
		[
			['M', 0, 600],
			['C', 300, 520, 700, 520, 1000, 600]
		],
		open([200, 560], [200, 360], [300, 360]),
		open([300, 360], [440, 540]),
		open([300, 360], [300, 560]),
		open([600, 540], [680, 280], [760, 540]),
		open([680, 280], [680, 340]),
		circle(150, 150, 45),
		oval(850, 150, 70, 22),
		circle(850, 150, 40),
		star(450, 120, 20),
		star(300, 220, 15)
	],
	// A branch with leaves and music staff lines; the parrot and the song notes are missing.
	'Draw a parrot teaching a song': [
		[
			['M', 0, 420],
			['C', 300, 400, 700, 460, 1000, 420]
		],
		[
			['M', 0, 450],
			['C', 300, 430, 700, 490, 1000, 450]
		],
		leaf(200, 420, 130, 330, 30),
		leaf(800, 440, 880, 350, 30),
		...[100, 140, 180, 220, 260].map((y) => open([620, y], [950, y]))
	],
	// Seabed rocks, bubbles and waves; the jellyfish and its lights are yours.
	'Draw a jellyfish wearing party lights': [
		wave(0, 1000, 80, 6, 14),
		hump(50, 300, 640, 90),
		hump(650, 950, 640, 120),
		open([0, 640], [1000, 640]),
		circle(150, 300, 20),
		circle(190, 240, 12),
		circle(830, 360, 18),
		circle(880, 300, 12)
	],
	// Two cliffs and some clouds with a gap between; the rainbow bridge is for you.
	'Draw a bridge made of rainbows': [
		poly([0, 700], [0, 420], [220, 420], [300, 480], [300, 700]),
		poly([1000, 700], [1000, 420], [780, 420], [700, 480], [700, 700]),
		[
			['M', 100, 220],
			['C', 80, 170, 160, 150, 190, 190],
			['C', 220, 140, 290, 170, 280, 220],
			['Z']
		],
		[
			['M', 700, 200],
			['C', 680, 150, 760, 130, 790, 170],
			['C', 820, 120, 890, 150, 880, 200],
			['Z']
		],
		circle(500, 100, 45)
	],
	// Garden rows with sprouts, a watering can and a fence; the robot and the silly vegetables are yours.
	'Draw a robot gardener growing silly vegetables': [
		open([0, 560], [1000, 560]),
		open([0, 640], [1000, 640]),
		...[150, 330, 510, 690, 870].map((x) => open([x, 560], [x, 520])),
		...[150, 330, 510, 690, 870].map((x) => leaf(x, 520, x + 40, 480, 12)),
		open([0, 450], [1000, 450]),
		...[0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((x) => open([x, 450], [x, 380])),
		rect(840, 580, 70, 50)
	],
	// A tiny cottage on a grassy path; the turtle that carries it is yours.
	'Draw a turtle carrying a tiny house': [
		rect(380, 280, 240, 160),
		poly([350, 280], [500, 180], [650, 280]),
		rect(470, 350, 60, 90),
		rect(560, 320, 40, 40),
		open([590, 240], [590, 170]),
		open([0, 600], [1000, 600]),
		...grass([100, 200, 800, 900], 600)
	],
	// A crescent moon, stars and a hill; the cow doing the jumping is missing.
	'Draw a cow jumping over a crescent moon': [
		crescent(500, 400, 110),
		hump(0, 1000, 640, 80),
		star(150, 120, 25),
		star(850, 150, 30),
		star(400, 100, 15),
		star(700, 90, 18)
	],
	// A leaf path and some grass; the sparkly-shelled snail is yours.
	'Draw a snail with a sparkly shell': [
		leaf(100, 560, 900, 560, 80),
		open([100, 560], [900, 560]),
		...grass([60, 130, 920, 960], 640),
		circle(850, 140, 45)
	],
	// Seaweed, rocks and bubbles; the fish with the crown is up to you.
	'Draw a fish wearing a tiny crown': [
		wave(0, 1000, 70, 6, 12),
		[
			['M', 120, 660],
			['C', 70, 570, 170, 500, 120, 420]
		],
		[
			['M', 880, 660],
			['C', 830, 570, 930, 500, 880, 400]
		],
		hump(300, 600, 660, 60),
		circle(300, 200, 20),
		circle(330, 150, 13),
		open([0, 660], [1000, 660])
	],
	// A tree branch with a hanging lantern; the owl reading beneath its light is yours.
	'Draw an owl reading by lantern light': [
		poly([0, 700], [60, 330], [180, 330], [240, 700]),
		[
			['M', 120, 330],
			['C', 400, 300, 700, 360, 1000, 320]
		],
		open([760, 335], [760, 400]),
		rect(730, 400, 60, 90),
		open([730, 400], [745, 380], [775, 380], [790, 400]),
		leaf(450, 330, 400, 260, 25)
	],
	// A branch and a big leaf with a ragged bite taken out of the edge; the caterpillar is yours.
	'Draw a caterpillar eating a giant leaf': [
		[
			['M', 0, 560],
			['C', 300, 540, 700, 600, 1000, 560]
		],
		[
			['M', 250, 560],
			['C', 200, 350, 400, 150, 800, 160],
			['L', 780, 200],
			['L', 810, 240],
			['L', 770, 280],
			['C', 740, 460, 520, 560, 250, 560]
		],
		open([260, 540], [700, 220]),
		open([400, 440], [450, 330]),
		open([520, 380], [600, 340])
	],
	// Flower stems, leaves and a sun; the butterfly and its patterned wings are missing.
	'Draw a butterfly with patterned wings': [
		open([0, 600], [1000, 600]),
		open([150, 600], [150, 380]),
		open([850, 600], [850, 330]),
		circle(150, 340, 40),
		circle(850, 290, 40),
		leaf(150, 520, 80, 470, 15),
		leaf(850, 520, 920, 470, 15),
		circle(500, 110, 50),
		...grass([60, 300, 700, 940], 600)
	],
	// Waves and a sunny horizon; the whale and the bubbly spout are yours.
	'Draw a whale spouting a fountain of bubbles': [
		open([0, 330], [1000, 330]),
		wave(0, 1000, 480, 7, 16),
		wave(0, 1000, 590, 7, 16),
		wave(0, 1000, 670, 7, 12),
		circle(850, 200, 60),
		[['M', 100, 140], ['C', 80, 90, 160, 70, 190, 110], ['C', 220, 60, 290, 90, 280, 140], ['Z']]
	]
};
