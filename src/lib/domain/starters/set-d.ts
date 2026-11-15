/**
 * Prompt starters, batch D (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-d.ts too.
 */
import type { PathCmd } from '../drawing.js';
import { circle, hump, open, oval, poly, rect, type Path } from './shapes.js';

/** A little four-point sparkle (a star in the sky). */
const spark = (x: number, y: number, s = 14): Path => [
	['M', x - s, y],
	['L', x + s, y],
	['M', x, y - s],
	['L', x, y + s]
];
/** A row of `n` rolling waves from x0 to x1 along y, each `amp` tall. */
const wave = (x0: number, x1: number, y: number, amp: number, n: number): Path => {
	const w = (x1 - x0) / n;
	const cmds: PathCmd[] = [['M', x0, y]];
	for (let i = 0; i < n; i++) {
		const a = x0 + i * w;
		cmds.push(['C', a + w * 0.25, y - amp, a + w * 0.75, y + amp, a + w, y]);
	}
	return cmds;
};
/** A bare palm tree: a bent trunk and four drooping fronds. */
const palm = (x: number, y: number): Path[] => [
	[
		['M', x, y],
		['C', x + 20, y - 60, x - 10, y - 120, x + 10, y - 170]
	],
	open([x + 10, y - 170], [x - 50, y - 150]),
	open([x + 10, y - 170], [x + 70, y - 150]),
	open([x + 10, y - 170], [x - 30, y - 200]),
	open([x + 10, y - 170], [x + 50, y - 200])
];

export const SET_D: Readonly<Record<string, readonly Path[]>> = {
	// The sandcastle with its towers and flag poles; the crab is yours to add.
	'Draw a crab building a sandcastle': [
		open([40, 560], [960, 560]),
		rect(560, 400, 200, 160),
		rect(490, 340, 70, 220),
		rect(760, 340, 70, 220),
		open([490, 340], [490, 320], [510, 320], [510, 340]),
		open([540, 340], [540, 320]),
		open([760, 340], [760, 320], [780, 320], [780, 340]),
		open([810, 340], [810, 320]),
		open([660, 340], [660, 280]),
		wave(40, 400, 640, 12, 3)
	],
	// A fence, a muddy puddle and the splash lines; no pig yet.
	'Draw a pig splashing in a puddle': [
		open([40, 470], [960, 470]),
		open([100, 470], [100, 380]),
		open([300, 470], [300, 380]),
		open([500, 470], [500, 380]),
		open([700, 470], [700, 380]),
		open([900, 470], [900, 380]),
		open([80, 410], [920, 410]),
		oval(500, 590, 280, 60),
		open([300, 540], [270, 500]),
		open([500, 520], [500, 470]),
		open([700, 540], [730, 500])
	],
	// A pasture: rolling hill, fence and sun; the horse and its mane are for you.
	'Draw a horse with a flowing mane': [
		hump(0, 500, 500, 50),
		open([20, 600], [980, 600]),
		open([140, 600], [140, 500]),
		open([860, 600], [860, 500]),
		open([500, 600], [500, 500]),
		open([100, 530], [900, 530]),
		circle(850, 130, 60),
		open([850, 40], [850, 20]),
		open([940, 130], [960, 130]),
		open([760, 130], [740, 130])
	],
	// A park with a tree, a bench and the ball mid-bounce; the dog is missing.
	'Draw a dog chasing a ball in the park': [
		open([20, 580], [980, 580]),
		rect(120, 260, 50, 320),
		circle(145, 200, 100),
		circle(840, 380, 40),
		open([760, 400], [720, 420]),
		open([770, 370], [720, 360]),
		open([840, 450], [840, 580]),
		rect(820, 470, 120, 20)
	],
	// The window and the sunbeam it throws on the floor; the cat and its cushion are yours.
	'Draw a cat napping in a sunbeam': [
		rect(600, 60, 280, 280),
		open([740, 60], [740, 340]),
		open([600, 200], [880, 200]),
		poly([600, 340], [880, 340], [820, 600], [320, 600]),
		open([20, 440], [980, 440])
	],
	// Carrot tops poking out of garden rows, behind a fence; the bunny hides among them.
	'Draw a bunny hiding in a garden of carrots': [
		open([20, 360], [980, 360]),
		open([100, 360], [100, 280]),
		open([300, 360], [300, 280]),
		open([500, 360], [500, 280]),
		open([700, 360], [700, 280]),
		open([900, 360], [900, 280]),
		open([60, 300], [940, 300]),
		open([20, 560], [980, 560]),
		open([180, 500], [200, 440], [220, 500]),
		open([420, 500], [440, 440], [460, 500]),
		open([620, 500], [640, 440], [660, 500]),
		open([820, 500], [840, 440], [860, 500]),
		open([40, 640], [960, 640])
	],
	// A wedge of cheese with holes, a door and a window; the mouse is not home yet.
	'Draw a mouse living inside a cheese house': [
		poly([200, 560], [800, 560], [800, 300], [200, 420]),
		[
			['M', 200, 420],
			['L', 300, 340],
			['L', 800, 300]
		],
		rect(560, 440, 100, 120),
		circle(300, 480, 30),
		circle(420, 440, 22),
		circle(720, 360, 24),
		circle(300, 380, 14),
		open([40, 560], [960, 560])
	],
	// A branch from the tree and a setting sun; the bat hangs upside down from the branch.
	'Draw a bat hanging upside down at sunset': [
		open([0, 90], [400, 110], [700, 80], [1000, 100]),
		open([400, 110], [360, 180]),
		open([700, 80], [740, 150]),
		open([0, 560], [1000, 560]),
		hump(300, 700, 560, 140),
		open([500, 380], [500, 330]),
		open([360, 420], [320, 380]),
		open([640, 420], [680, 380])
	],
	// An iceberg in the sea; the polar bear is not on it yet.
	'Draw a polar bear on an iceberg': [
		poly(
			[220, 450],
			[380, 380],
			[500, 300],
			[600, 400],
			[760, 390],
			[820, 450],
			[740, 580],
			[320, 580]
		),
		open([380, 380], [440, 450], [400, 580]),
		wave(20, 220, 500, 14, 2),
		wave(820, 980, 500, 14, 2),
		wave(20, 980, 630, 14, 6),
		spark(150, 150),
		spark(850, 120)
	],
	// Tall bamboo stalks with joints and leaves; the panda sits in front.
	'Draw a panda eating bamboo': [
		open([700, 40], [700, 560]),
		open([760, 40], [760, 560]),
		open([830, 80], [830, 560]),
		open([685, 180], [775, 180]),
		open([685, 330], [775, 330]),
		open([815, 240], [845, 240]),
		open([815, 400], [845, 400]),
		open([700, 200], [640, 160]),
		open([830, 140], [900, 100]),
		hump(100, 640, 600, 80),
		open([20, 600], [980, 600])
	],
	// Tree trunks and hanging vines; the monkey swings between them.
	'Draw a monkey swinging through the jungle': [
		rect(100, 80, 70, 520),
		rect(830, 80, 70, 520),
		open([40, 600], [960, 600]),
		[
			['M', 320, 0],
			['C', 300, 120, 340, 200, 320, 300]
		],
		[
			['M', 520, 0],
			['C', 500, 120, 540, 220, 520, 340]
		],
		[
			['M', 700, 0],
			['C', 680, 100, 720, 180, 700, 260]
		],
		circle(135, 70, 60),
		circle(865, 70, 60)
	],
	// A shallow pond with lily pads and reeds; the flamingo stands in the water.
	'Draw a flamingo standing on one leg': [
		open([20, 480], [980, 480]),
		wave(20, 980, 560, 12, 6),
		oval(180, 520, 70, 18),
		oval(800, 530, 80, 20),
		open([900, 480], [900, 340]),
		open([940, 480], [940, 380]),
		oval(900, 330, 12, 22),
		circle(150, 120, 55),
		open([150, 40], [150, 20])
	],
	// A garden with hedges, flower stems and a sunny sky; the peacock struts in the middle.
	'Draw a peacock showing off its feathers': [
		open([20, 600], [980, 600]),
		hump(60, 300, 600, 90),
		hump(700, 940, 600, 90),
		open([380, 600], [380, 520]),
		open([620, 600], [620, 520]),
		circle(380, 500, 20),
		circle(620, 500, 20),
		circle(880, 100, 55),
		open([880, 20], [880, 10])
	],
	// Big rolling waves and a sun; the dolphin leaps over them.
	'Draw a dolphin leaping over a wave': [
		wave(20, 980, 540, 40, 4),
		wave(20, 980, 620, 30, 5),
		circle(160, 130, 60),
		open([160, 40], [160, 20]),
		open([250, 130], [270, 130]),
		open([80, 130], [60, 130]),
		spark(800, 160, 10),
		spark(900, 220, 10)
	],
	// The moon, stars and clouds around an empty patch of sky; build the star house there.
	'Draw a star-shaped house in the night sky': [
		[
			['M', 140, 90],
			['C', 60, 110, 60, 220, 150, 230],
			['C', 100, 190, 100, 130, 140, 90]
		],
		spark(300, 100),
		spark(800, 80),
		spark(900, 260),
		spark(120, 400),
		spark(880, 460),
		wave(40, 360, 610, 20, 3),
		wave(640, 960, 640, 20, 3)
	],
	// The hilltop, a gate in the curtain wall and the moat; the towers and flags are yours.
	'Draw a castle with tall towers and flags': [
		hump(0, 1000, 600, 70),
		rect(260, 380, 480, 200),
		open([260, 380], [260, 355], [300, 355], [300, 380]),
		open([340, 380], [340, 355], [380, 355], [380, 380]),
		open([420, 380], [420, 355], [460, 355], [460, 380]),
		open([500, 380], [500, 355], [540, 355], [540, 380]),
		open([580, 380], [580, 355], [620, 355], [620, 380]),
		open([660, 380], [660, 355], [700, 355], [700, 380]),
		[
			['M', 440, 580],
			['L', 440, 490],
			['C', 440, 430, 560, 430, 560, 490],
			['L', 560, 580]
		]
	],
	// The car's body, wheels and the road; the flames are for you.
	'Draw a race car with flames on the side': [
		poly(
			[140, 470],
			[860, 470],
			[880, 410],
			[700, 380],
			[600, 310],
			[380, 310],
			[300, 380],
			[160, 400]
		),
		open([490, 310], [490, 380]),
		circle(300, 490, 60),
		circle(700, 490, 60),
		open([20, 570], [980, 570]),
		open([40, 640], [140, 640]),
		open([300, 640], [440, 640]),
		open([600, 640], [740, 640])
	],
	// The truck's cab, body and wheels on the road; add the ladder, hose and lights.
	'Draw a fire truck on its way to help': [
		rect(160, 330, 440, 190),
		poly([600, 380], [780, 380], [840, 450], [840, 520], [600, 520]),
		rect(650, 400, 80, 60),
		circle(280, 540, 55),
		circle(700, 540, 55),
		open([20, 600], [980, 600]),
		open([20, 280], [100, 280]),
		open([40, 320], [100, 320])
	],
	// A barn, a fence and furrows in the field; the tractor rolls through them.
	'Draw a tractor on a busy farm': [
		open([20, 480], [980, 480]),
		rect(60, 240, 220, 240),
		poly([40, 240], [170, 150], [300, 240]),
		rect(120, 340, 100, 140),
		open([300, 440], [940, 440]),
		open([340, 480], [340, 400]),
		open([560, 480], [560, 400]),
		open([780, 480], [780, 400]),
		open([20, 580], [980, 580]),
		open([20, 650], [980, 650])
	],
	// A city skyline with lots of windows and clouds; the airplane flies above.
	'Draw an airplane flying over the city': [
		rect(60, 400, 140, 260),
		rect(220, 320, 120, 340),
		rect(360, 440, 160, 220),
		rect(540, 280, 130, 380),
		rect(690, 380, 120, 280),
		rect(830, 450, 120, 210),
		rect(250, 360, 20, 20),
		rect(290, 360, 20, 20),
		rect(570, 320, 20, 20),
		rect(620, 320, 20, 20),
		open([20, 660], [980, 660]),
		hump(100, 300, 180, 40),
		hump(700, 920, 120, 40)
	],
	// A tall tree with a bare branch top, clouds and a sunny sky; the helicopter and kitten are yours.
	'Draw a helicopter rescuing a kitten': [
		rect(440, 360, 70, 300),
		open([20, 660], [980, 660]),
		open([475, 360], [400, 270]),
		open([475, 360], [560, 260]),
		open([475, 360], [475, 220]),
		hump(100, 300, 120, 40),
		hump(780, 960, 220, 40),
		circle(880, 100, 40)
	],
	// The lake, far hills and the boat's hull and mast; the sails are yours.
	'Draw a sailboat on a calm lake': [
		open([20, 440], [220, 340], [420, 440], [600, 380], [800, 440], [980, 400]),
		wave(20, 980, 520, 10, 8),
		wave(20, 980, 640, 10, 8),
		poly([320, 540], [680, 540], [620, 600], [380, 600]),
		open([500, 540], [500, 200]),
		circle(850, 130, 55)
	],
	// A launch tower, pad and billowing smoke; the rocket is yours to add.
	'Draw a rocket blasting off into space': [
		open([20, 600], [980, 600]),
		rect(780, 200, 70, 400),
		open([780, 200], [850, 280], [780, 360], [850, 440], [780, 520], [850, 600]),
		open([780, 200], [700, 200]),
		circle(380, 590, 40),
		circle(500, 590, 50),
		circle(620, 590, 40),
		spark(150, 100),
		spark(300, 250),
		spark(950, 90)
	],
	// A planet below and a tether line floating in space; the astronaut hangs on the end.
	'Draw an astronaut floating among the stars': [
		hump(100, 900, 700, 120),
		[
			['M', 0, 120],
			['C', 150, 100, 200, 180, 300, 180],
			['C', 400, 180, 420, 260, 480, 300]
		],
		spark(700, 100),
		spark(880, 220),
		spark(200, 440),
		spark(780, 420),
		spark(560, 100, 10),
		circle(840, 560, 24)
	],
	// A landed flying saucer with its door open, and stars; the alien steps out and waves.
	'Draw an alien saying hello': [
		oval(620, 400, 260, 70),
		[
			['M', 520, 360],
			['C', 540, 250, 700, 250, 720, 360]
		],
		open([480, 460], [450, 560]),
		open([760, 460], [790, 560]),
		open([20, 580], [980, 580]),
		spark(130, 100),
		spark(300, 220),
		spark(900, 120)
	],
	// A starry sky, two small moons and a hint of the planet; add the rings and colors.
	'Draw a planet with rings and moons': [
		circle(500, 350, 130),
		circle(200, 160, 30),
		circle(820, 560, 40),
		spark(120, 520),
		spark(300, 600),
		spark(880, 200),
		spark(700, 80),
		spark(80, 340, 10)
	],
	// The sea, the island and its palm trees; the volcano rises in the middle.
	'Draw a volcano on a tropical island': [
		hump(100, 900, 540, 90),
		wave(20, 980, 600, 12, 8),
		wave(20, 980, 660, 12, 8),
		...palm(220, 520),
		...palm(790, 520),
		circle(900, 100, 55)
	],
	// Cliff walls on both sides, a river and rocks; the waterfall pours in between.
	'Draw a waterfall in a hidden valley': [
		poly([0, 0], [260, 0], [300, 200], [220, 360], [260, 560], [0, 560]),
		poly([1000, 0], [740, 0], [700, 220], [780, 380], [740, 560], [1000, 560]),
		wave(260, 740, 620, 14, 4),
		oval(380, 590, 50, 20),
		oval(620, 600, 60, 22),
		open([20, 660], [980, 660])
	],
	// A fence, flower beds and trees; draw the winding path itself.
	'Draw a garden with a winding path': [
		open([20, 300], [980, 300]),
		open([80, 300], [80, 230]),
		open([260, 300], [260, 230]),
		open([440, 300], [440, 230]),
		open([620, 300], [620, 230]),
		open([800, 300], [800, 230]),
		open([60, 250], [940, 250]),
		circle(150, 440, 22),
		circle(300, 560, 22),
		circle(820, 450, 22),
		circle(900, 570, 22),
		hump(640, 780, 660, 60)
	],
	// The trunk, a big branch and the ropes; the swing seat and leafy crown are yours.
	'Draw a tree with a swing': [
		poly([440, 620], [460, 380], [520, 380], [540, 620]),
		open([460, 400], [300, 300], [150, 290]),
		open([520, 400], [660, 300], [820, 300]),
		open([240, 306], [240, 470]),
		open([290, 308], [290, 470]),
		open([20, 620], [980, 620])
	]
};
