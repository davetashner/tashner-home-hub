/**
 * Prompt starters, batch B (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-b.ts too.
 */
import { circle, hump, open, oval, poly, rect, type Path } from './shapes.js';

/** A little four-point twinkle: a plus sign. */
const star = (x: number, y: number, r: number): Path => [
	['M', x - r, y],
	['L', x + r, y],
	['M', x, y - r],
	['L', x, y + r]
];
/** A puffy cloud sitting on y, centred about x. */
const cloud = (x: number, y: number): Path => [
	['M', x - 70, y],
	['C', x - 110, y, x - 110, y - 50, x - 60, y - 50],
	['C', x - 60, y - 100, x + 20, y - 100, x + 30, y - 50],
	['C', x + 80, y - 70, x + 110, y - 10, x + 70, y],
	['Z']
];
/** A raindrop streak. */
const drop = (x: number, y: number): Path => open([x, y], [x - 8, y + 30]);

export const SET_B: Readonly<Record<string, readonly Path[]>> = {
	// A table with a plate, a fried egg, toast and a mug; the dragon's seat is empty.
	'Draw a dragon having breakfast': [
		open([120, 470], [880, 470]),
		open([200, 470], [200, 640]),
		open([800, 470], [800, 640]),
		oval(500, 450, 120, 20),
		circle(480, 440, 20),
		rect(540, 425, 40, 22),
		rect(690, 390, 60, 80),
		[
			['M', 750, 410],
			['C', 790, 410, 790, 450, 750, 450]
		],
		open([60, 640], [940, 640])
	],
	// A stage with a spotlight, a disco ball and two speakers; the robot is yours to draw.
	'Draw a robot learning to dance': [
		rect(150, 570, 700, 50),
		rect(110, 380, 110, 190),
		circle(165, 450, 28),
		circle(165, 520, 18),
		rect(780, 380, 110, 190),
		circle(835, 450, 28),
		circle(835, 520, 18),
		open([500, 0], [500, 80]),
		circle(500, 120, 40),
		open([460, 120], [540, 120]),
		rect(270, 0, 90, 30),
		open([285, 30], [190, 560]),
		open([345, 30], [440, 560])
	],
	// A moon hill, craters, a distant planet and a flag; no cat and no helmet yet.
	'Draw a cat wearing a space helmet': [
		hump(0, 1000, 640, 140),
		oval(250, 630, 60, 12),
		oval(780, 640, 70, 12),
		circle(820, 150, 60),
		oval(820, 150, 100, 18),
		star(150, 120, 14),
		star(400, 70, 10),
		star(600, 190, 12),
		open([880, 540], [880, 400]),
		poly([880, 400], [950, 425], [880, 450])
	],
	// A big trunk, branches and a ladder; the treehouse itself is for you to dream up.
	'Draw your dream treehouse': [
		poly([380, 640], [430, 340], [440, 200], [560, 200], [570, 340], [620, 640]),
		open([440, 240], [300, 130]),
		open([560, 230], [700, 120]),
		open([440, 330], [250, 330]),
		open([560, 330], [880, 330]),
		open([790, 330], [790, 640]),
		open([870, 330], [870, 640]),
		open([790, 560], [870, 560]),
		open([790, 480], [870, 480]),
		open([790, 400], [870, 400]),
		open([40, 640], [960, 640])
	],
	// A two-lane track with a start line and a finish flag; the racers are missing.
	'Draw a snail racing a turtle': [
		open([60, 520], [940, 520]),
		open([60, 580], [940, 580]),
		open([60, 640], [940, 640]),
		open([160, 520], [160, 640]),
		open([830, 520], [830, 300]),
		rect(830, 300, 100, 60),
		open([880, 300], [880, 360]),
		open([830, 330], [930, 330])
	],
	// Waves and a row of tiny houses with a sun; the whale to carry them is missing.
	'Draw a whale carrying a tiny town on its back': [
		rect(300, 330, 70, 60),
		poly([290, 330], [335, 290], [380, 330]),
		rect(410, 310, 60, 80),
		poly([400, 310], [440, 265], [480, 310]),
		rect(520, 340, 80, 50),
		poly([510, 340], [560, 300], [610, 340]),
		hump(0, 200, 600, 40),
		hump(200, 400, 640, 40),
		hump(600, 800, 620, 40),
		hump(800, 1000, 650, 40),
		circle(860, 130, 55)
	],
	// A kitchen table with a window and a giant two-layer cake; the baker is missing.
	'Draw a bear baking a giant cake': [
		open([80, 530], [920, 530]),
		open([160, 530], [160, 650]),
		open([840, 530], [840, 650]),
		rect(560, 410, 260, 120),
		rect(610, 320, 160, 90),
		open([690, 320], [690, 270]),
		open([650, 320], [650, 280]),
		open([730, 320], [730, 280]),
		rect(120, 100, 160, 150),
		open([200, 100], [200, 250]),
		open([120, 175], [280, 175])
	],
	// Three rainbow arches and a hill with clouds; whatever waits at the end is up to you.
	'Draw a rainbow with a surprise at the end': [
		hump(120, 700, 560, 240),
		hump(170, 650, 560, 190),
		hump(220, 600, 560, 140),
		open([40, 560], [960, 560]),
		cloud(120, 580),
		cloud(720, 590),
		cloud(880, 140)
	],
	// A stage with a drum, a keyboard and a guitar; the octopus is yours.
	'Draw an octopus playing every instrument': [
		open([60, 640], [940, 640]),
		oval(170, 520, 90, 25),
		rect(80, 520, 180, 110),
		open([120, 540], [140, 625]),
		open([220, 540], [200, 625]),
		rect(680, 520, 240, 70),
		open([740, 520], [740, 590]),
		open([800, 520], [800, 590]),
		open([860, 520], [860, 590]),
		oval(780, 440, 60, 48),
		oval(780, 375, 45, 38),
		circle(780, 440, 14),
		rect(770, 200, 20, 140),
		rect(762, 165, 36, 35)
	],
	// A picket fence, flowers and a sun; the friendly monster is missing.
	'Draw a friendly monster in the garden': [
		open([0, 520], [1000, 520]),
		open([0, 420], [1000, 420]),
		poly([60, 520], [60, 370], [90, 340], [120, 370], [120, 520]),
		poly([880, 520], [880, 370], [910, 340], [940, 370], [940, 520]),
		open([160, 640], [160, 597]),
		circle(160, 575, 22),
		open([840, 640], [840, 597]),
		circle(840, 575, 22),
		circle(150, 110, 55),
		open([30, 640], [970, 640])
	],
	// A moon hill with craters, a far-off Earth and a little flag; the bunny hops in later.
	'Draw a bunny exploring the moon': [
		hump(0, 1000, 640, 150),
		oval(260, 640, 70, 12),
		oval(720, 635, 55, 10),
		circle(800, 150, 65),
		star(140, 100, 14),
		star(450, 60, 10),
		star(560, 220, 12),
		open([880, 560], [880, 420]),
		poly([880, 420], [950, 445], [880, 470])
	],
	// A seabed with a picnic blanket, a basket, seaweed, bubbles and shells; no mermaid yet.
	'Draw a mermaid having a picnic under the sea': [
		poly([220, 520], [780, 520], [850, 610], [150, 610]),
		rect(620, 465, 100, 55),
		hump(630, 710, 465, 40),
		oval(400, 530, 50, 10),
		[
			['M', 80, 640],
			['C', 40, 560, 120, 520, 80, 440],
			['C', 60, 400, 100, 380, 90, 340]
		],
		[
			['M', 920, 640],
			['C', 880, 560, 960, 520, 920, 440]
		],
		open([0, 640], [1000, 640]),
		circle(300, 200, 25),
		circle(360, 120, 15),
		circle(650, 170, 20)
	],
	// A rain cloud, drops, a puddle and a mushroom; the mouse and its umbrella are missing.
	'Draw a mouse with a tiny umbrella': [
		cloud(250, 150),
		drop(180, 190),
		drop(250, 200),
		drop(320, 190),
		drop(480, 120),
		drop(620, 160),
		drop(800, 130),
		drop(740, 300),
		oval(700, 620, 150, 25),
		oval(700, 620, 80, 10),
		hump(130, 260, 560, 70),
		open([195, 560], [195, 620]),
		open([40, 640], [960, 640])
	],
	// Rolling hills, clouds, a held string and a ribbon tail; the animal kite goes between them.
	'Draw a kite shaped like an animal': [
		[
			['M', 200, 602],
			['C', 320, 520, 420, 560, 520, 400],
			['C', 560, 330, 570, 260, 580, 190]
		],
		[
			['M', 590, 420],
			['C', 560, 470, 640, 490, 610, 540],
			['C', 590, 570, 660, 580, 640, 620]
		],
		hump(0, 400, 690, 90),
		hump(520, 1000, 690, 120),
		cloud(180, 200),
		cloud(840, 120)
	],
	// An easel with a blank canvas, paint pots and a palette; the unicorn is yours.
	'Draw a unicorn who loves to paint': [
		rect(560, 130, 280, 220),
		open([700, 350], [620, 640]),
		open([700, 350], [780, 640]),
		open([700, 350], [700, 600]),
		open([590, 410], [810, 410]),
		rect(860, 580, 50, 60),
		rect(920, 590, 50, 50),
		open([60, 640], [960, 640]),
		[
			['M', 100, 580],
			['C', 100, 520, 220, 510, 260, 550],
			['C', 290, 590, 220, 620, 160, 600],
			['C', 120, 595, 100, 590, 100, 580]
		]
	],
	// A log, fallen leaves and a leafy ground; no hedgehog and no scarf yet.
	'Draw a hedgehog wearing a scarf': [
		rect(620, 470, 250, 110),
		oval(620, 525, 30, 55),
		oval(620, 525, 12, 24),
		poly([200, 100], [230, 140], [200, 180], [170, 140]),
		poly([400, 200], [430, 240], [400, 280], [370, 240]),
		poly([800, 140], [830, 180], [800, 220], [770, 180]),
		poly([120, 600], [150, 625], [120, 650], [90, 625]),
		poly([900, 620], [930, 645], [900, 670], [870, 645]),
		open([40, 640], [960, 640])
	],
	// A plate, a fork, a knife and a napkin; the food with its funny face is for you.
	'Draw your favorite food with a funny face': [
		circle(500, 360, 250),
		circle(500, 360, 190),
		open([100, 180], [100, 280]),
		open([140, 180], [140, 280]),
		open([180, 180], [180, 280]),
		open([100, 280], [180, 280]),
		open([140, 280], [140, 560]),
		poly([890, 180], [930, 180], [930, 560], [890, 560]),
		rect(790, 590, 160, 80)
	],
	// A branch with leaves and a few twigs waiting to be woven; the bird is missing.
	'Draw a bird building a cozy nest': [
		[
			['M', 0, 430],
			['C', 250, 400, 450, 420, 700, 370]
		],
		[
			['M', 0, 500],
			['C', 250, 470, 450, 480, 700, 430]
		],
		open([700, 370], [700, 430]),
		[
			['M', 500, 405],
			['C', 540, 330, 580, 280, 600, 220]
		],
		[
			['M', 700, 370],
			['C', 740, 310, 800, 320, 830, 350],
			['C', 800, 400, 740, 400, 700, 370]
		],
		[
			['M', 600, 220],
			['C', 600, 150, 680, 140, 700, 170],
			['C', 690, 220, 640, 240, 600, 220]
		],
		open([300, 620], [400, 600]),
		open([420, 640], [520, 625]),
		open([620, 600], [730, 620])
	],
	// A launch pad with a rocket, a window and stars; the puppy rider is missing.
	'Draw a puppy riding a rocket': [
		poly([350, 430], [350, 240], [410, 120], [470, 240], [470, 430]),
		circle(410, 260, 32),
		poly([350, 380], [290, 480], [350, 430]),
		poly([470, 380], [530, 480], [470, 430]),
		open([365, 430], [410, 540], [455, 430]),
		rect(250, 600, 320, 40),
		star(700, 120, 14),
		star(850, 260, 12),
		star(150, 150, 10),
		star(800, 480, 14)
	],
	// A circus mat, a spotlight and a big ball; the elephant balances on its own.
	'Draw an elephant doing a handstand': [
		poly([180, 620], [820, 620], [750, 550], [250, 550]),
		circle(500, 40, 30),
		open([480, 68], [260, 550]),
		open([520, 68], [740, 550]),
		circle(890, 540, 70),
		hump(820, 960, 540, 30),
		open([60, 650], [940, 650])
	],
	// Tall bare trunks and gumdrop bushes; the candy treetops are yours.
	'Draw a forest where the trees are candy': [
		rect(170, 340, 26, 300),
		rect(340, 280, 26, 360),
		rect(510, 360, 26, 280),
		rect(680, 300, 26, 340),
		rect(850, 350, 26, 290),
		hump(240, 330, 640, 40),
		hump(420, 500, 640, 35),
		hump(740, 840, 640, 40),
		open([0, 640], [1000, 640])
	],
	// A lily pad table with a teapot and cups, and a seat pad; the frog host is missing.
	'Draw a frog having a tea party': [
		oval(250, 580, 130, 30),
		oval(660, 580, 180, 35),
		open([620, 440], [620, 580]),
		oval(640, 430, 160, 25),
		oval(610, 385, 45, 35),
		hump(585, 635, 350, 20),
		open([655, 385], [700, 355]),
		[
			['M', 570, 385],
			['C', 530, 385, 530, 415, 570, 415]
		],
		rect(700, 395, 40, 32),
		rect(750, 400, 35, 28),
		open([60, 650], [940, 650])
	],
	// A laundry basket, a broom and a mop bucket on the floor; the superhero is yours.
	'Draw a superhero who helps with chores': [
		poly([130, 450], [320, 450], [290, 620], [160, 620]),
		open([150, 500], [300, 500]),
		open([160, 560], [290, 560]),
		open([770, 160], [770, 600]),
		poly([740, 600], [800, 600], [830, 660], [710, 660]),
		poly([860, 520], [980, 520], [960, 640], [880, 640]),
		hump(870, 970, 520, 40),
		open([40, 660], [960, 660])
	],
	// A bed with a pillow, a lamp and a moon window; the fox with the story book is missing.
	'Draw a fox reading a bedtime story': [
		rect(560, 420, 330, 130),
		rect(540, 340, 30, 280),
		oval(640, 400, 60, 20),
		open([890, 550], [890, 620]),
		rect(120, 90, 190, 210),
		open([215, 90], [215, 300]),
		open([120, 195], [310, 195]),
		circle(215, 195, 28),
		oval(300, 620, 220, 30),
		rect(940, 440, 50, 110),
		poly([930, 440], [960, 390], [1000, 440])
	],
	// A barn, a fence and a haystack; the hat-wearing animals fill the meadow.
	'Draw a farm where the animals wear hats': [
		rect(640, 300, 270, 220),
		poly([620, 300], [775, 190], [930, 300]),
		rect(730, 400, 90, 120),
		open([730, 400], [820, 520]),
		open([820, 400], [730, 520]),
		open([40, 520], [600, 520]),
		open([40, 460], [600, 460]),
		open([100, 520], [100, 430]),
		open([300, 520], [300, 430]),
		open([500, 520], [500, 430]),
		circle(150, 130, 50),
		open([0, 600], [1000, 600])
	],
	// Bunting, a table with a cake and a pile of presents; the bee party host is yours.
	'Draw a bee throwing a birthday party': [
		open([60, 130], [940, 130]),
		poly([150, 130], [230, 130], [190, 220]),
		poly([380, 130], [460, 130], [420, 220]),
		poly([540, 130], [620, 130], [580, 220]),
		poly([770, 130], [850, 130], [810, 220]),
		open([100, 560], [500, 560]),
		open([140, 560], [140, 650]),
		open([460, 560], [460, 650]),
		rect(240, 490, 120, 70),
		open([300, 490], [300, 450]),
		rect(700, 540, 100, 90),
		open([750, 540], [750, 630]),
		rect(820, 570, 90, 60)
	],
	// Stars, a ringed planet and a moon; the banana ship is yours to build.
	'Draw a spaceship shaped like a banana': [
		circle(800, 500, 100),
		oval(800, 500, 170, 30),
		circle(150, 140, 45),
		star(400, 80, 14),
		star(650, 150, 10),
		star(900, 100, 12),
		star(100, 400, 12),
		star(300, 600, 10),
		open([650, 260], [560, 320])
	],
	// A tent, a campfire, pine trees and a hill; fill the sky with stars and add the campers.
	'Draw a camping trip under a million stars': [
		poly([180, 600], [320, 380], [460, 600]),
		poly([280, 600], [320, 480], [360, 600]),
		open([600, 600], [720, 580]),
		open([600, 580], [720, 600]),
		open([650, 580], [650, 520]),
		poly([800, 600], [860, 380], [920, 600]),
		hump(0, 1000, 600, 40),
		star(120, 100, 10)
	],
	// A grassy hill, puddles, flowers and rain boots; the happy cloud and its friend are yours.
	'Draw a happy cloud with a rainy-day friend': [
		hump(0, 1000, 600, 70),
		oval(250, 640, 110, 18),
		oval(680, 635, 90, 15),
		open([150, 600], [150, 540]),
		circle(150, 520, 22),
		open([850, 600], [850, 530]),
		circle(850, 510, 22),
		drop(300, 330),
		drop(500, 380),
		drop(700, 340)
	],
	// Hills, a blanket, a basket and a big sandwich; the giant and the guest are missing.
	'Draw a gentle giant sharing lunch': [
		poly([0, 440], [250, 200], [500, 440]),
		poly([400, 440], [680, 250], [960, 440]),
		poly([200, 540], [800, 540], [900, 650], [100, 650]),
		rect(620, 460, 160, 80),
		hump(630, 770, 460, 50),
		poly([280, 540], [380, 540], [330, 480]),
		circle(450, 520, 20)
	]
};
