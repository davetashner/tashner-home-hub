/**
 * Prompt starters, batch E (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-e.ts too.
 */
import { circle, hump, open, oval, poly, rect, type Path } from './shapes.js';

export const SET_E: Readonly<Record<string, readonly Path[]>> = {
	// The bowl, its rim and chopsticks; the noodles are up to you.
	'Draw a big bowl of noodles': [
		[
			['M', 250, 340],
			['C', 250, 560, 380, 610, 500, 610],
			['C', 620, 610, 750, 560, 750, 340]
		],
		oval(500, 340, 250, 45),
		open([620, 300], [880, 90]),
		open([660, 310], [920, 130])
	],
	// Two tiers on a plate; the candles are missing.
	'Draw a birthday cake with lots of candles': [
		rect(250, 430, 500, 150),
		rect(320, 300, 360, 130),
		open([170, 580], [830, 580]),
		open([250, 500], [750, 500])
	],
	// Just the waffle cone; add the scoops.
	'Draw an ice cream cone with your favorite scoops': [
		poly([390, 360], [610, 360], [500, 650]),
		open([406, 403], [555, 505]),
		open([594, 403], [445, 505]),
		open([434, 476], [528, 578]),
		open([566, 476], [472, 578])
	],
	// A round crust with cut lines; no toppings yet.
	'Draw a pizza with silly toppings': [
		circle(500, 350, 270),
		circle(500, 350, 230),
		open([500, 120], [500, 580]),
		open([270, 350], [730, 350]),
		open([337, 187], [663, 513]),
		open([663, 187], [337, 513])
	],
	// An empty woven basket; fill it with fruit.
	'Draw a fruit basket full of colors': [
		poly([280, 430], [720, 430], [660, 620], [340, 620]),
		oval(500, 430, 220, 35),
		open([300, 500], [700, 500]),
		open([320, 560], [680, 560]),
		open([400, 440], [420, 615]),
		open([500, 465], [500, 620]),
		open([600, 440], [580, 615])
	],
	// The paper wrapper; the frosting and sprinkles are yours.
	'Draw a cupcake wearing sprinkles': [
		poly([350, 400], [650, 400], [590, 620], [410, 620]),
		open([430, 400], [450, 620]),
		open([500, 400], [500, 620]),
		open([570, 400], [550, 620]),
		open([200, 620], [800, 620])
	],
	// The blanket, a basket and a shady tree; the bears are not here yet.
	'Draw a teddy bear picnic': [
		poly([200, 490], [800, 490], [920, 650], [80, 650]),
		rect(670, 410, 120, 80),
		hump(680, 780, 410, 50),
		open([125, 310], [125, 500]),
		open([165, 310], [165, 500]),
		circle(145, 190, 120)
	],
	// An open box with its lid up; the toys are up to you.
	'Draw a toy box spilling over with toys': [
		rect(300, 380, 400, 230),
		poly([300, 380], [700, 380], [650, 290], [250, 290]),
		open([300, 450], [700, 450]),
		rect(470, 480, 60, 40),
		open([150, 610], [850, 610])
	],
	// Grass, a fence and the ball in the air; the dog is left to draw.
	'Draw a robot dog playing fetch': [
		open([0, 580], [1000, 580]),
		circle(800, 200, 45),
		rect(60, 380, 20, 200),
		rect(200, 380, 20, 200),
		open([40, 420], [240, 420]),
		open([40, 500], [240, 500]),
		open([300, 580], [315, 550], [330, 580]),
		open([600, 580], [615, 545], [630, 580])
	],
	// A tall stem, leaves and the ground; the flower head is yours.
	'Draw a giant sunflower taller than you': [
		open([485, 640], [485, 280]),
		open([515, 640], [515, 280]),
		poly([485, 520], [340, 440], [400, 560]),
		poly([515, 450], [660, 370], [600, 490]),
		open([100, 640], [900, 640])
	],
	// The stalk house with a door and a window; the cap is for you.
	'Draw a mushroom house in the woods': [
		poly([410, 640], [590, 640], [565, 360], [435, 360]),
		[
			['M', 470, 640],
			['L', 470, 540],
			['C', 470, 490, 530, 490, 530, 540],
			['L', 530, 640]
		],
		circle(500, 430, 25),
		rect(100, 200, 50, 440),
		rect(850, 180, 50, 460),
		open([60, 640], [940, 640])
	],
	// Reeds and a pond; the fairy and her dragonfly are missing.
	'Draw a fairy riding a dragonfly': [
		open([150, 650], [160, 300]),
		oval(160, 270, 15, 40),
		open([230, 650], [210, 380]),
		oval(208, 350, 14, 35),
		open([850, 650], [830, 250]),
		oval(830, 220, 15, 40),
		open([0, 620], [1000, 620]),
		oval(340, 665, 70, 15),
		oval(680, 668, 80, 16)
	],
	// A little castle and a cave; the knight and dragon are yours.
	'Draw a knight befriending a dragon': [
		rect(60, 380, 220, 220),
		rect(40, 320, 60, 80),
		rect(240, 320, 60, 80),
		open([130, 600], [130, 520], [210, 520], [210, 600]),
		open([0, 620], [1000, 620]),
		hump(620, 980, 620, 280)
	],
	// A workbench with gears and a toolbox; the princess and robots are yours.
	'Draw a princess who fixes robots': [
		open([150, 450], [850, 450]),
		open([200, 450], [200, 640]),
		open([800, 450], [800, 640]),
		rect(620, 370, 130, 80),
		circle(350, 410, 40),
		circle(450, 420, 28),
		open([650, 370], [660, 340], [720, 340], [730, 370]),
		rect(120, 120, 400, 20),
		open([160, 140], [160, 190]),
		open([480, 140], [480, 190])
	],
	// The sea floor, seaweed and bubbles; place the chest yourself.
	'Draw a treasure chest on the ocean floor': [
		[
			['M', 0, 600],
			['C', 250, 560, 450, 640, 700, 590],
			['C', 800, 570, 900, 600, 1000, 590]
		],
		open([100, 600], [90, 480], [120, 380]),
		open([160, 600], [170, 500], [140, 420]),
		open([880, 595], [870, 470], [910, 360]),
		poly([760, 600], [800, 540], [850, 600]),
		circle(500, 200, 20),
		circle(530, 130, 12),
		circle(470, 90, 8)
	],
	// The paper border, a compass and waves; the island is up to you.
	'Draw a map to a secret island': [
		rect(60, 50, 880, 600),
		rect(90, 80, 820, 540),
		circle(790, 190, 60),
		open([790, 120], [790, 260]),
		open([720, 190], [860, 190]),
		open([130, 540], [180, 520], [230, 540], [280, 520]),
		open([500, 570], [550, 550], [600, 570], [650, 550]),
		open([200, 160], [250, 140], [300, 160])
	],
	// The roof, poles and platform; add the horses.
	'Draw a carousel at the fair': [
		poly([240, 230], [760, 230], [500, 90]),
		open([240, 230], [270, 270], [300, 230], [330, 270], [360, 230]),
		open([640, 230], [670, 270], [700, 230], [730, 270], [760, 230]),
		oval(500, 580, 340, 60),
		open([340, 270], [340, 540]),
		open([450, 270], [450, 550]),
		open([550, 270], [550, 550]),
		open([660, 270], [660, 540])
	],
	// The wheel and its legs under a moon; the cabins are yours.
	'Draw a Ferris wheel at night': [
		circle(500, 310, 240),
		circle(500, 310, 30),
		open([500, 310], [500, 70]),
		open([500, 310], [500, 550]),
		open([260, 310], [740, 310]),
		open([330, 140], [670, 480]),
		open([670, 140], [330, 480]),
		open([500, 310], [380, 650]),
		open([500, 310], [620, 650]),
		open([300, 650], [700, 650]),
		circle(880, 100, 50)
	],
	// The tent, pole and door; the stripes are for you.
	'Draw a circus tent with a striped top': [
		rect(260, 400, 480, 220),
		poly([210, 400], [500, 190], [790, 400]),
		open([500, 190], [500, 80]),
		poly([500, 80], [590, 105], [500, 130]),
		open([440, 620], [440, 520], [500, 470], [560, 520], [560, 620]),
		open([100, 620], [900, 620])
	],
	// The drum kit and a stool; the drummer is missing.
	'Draw a musician playing the drums': [
		circle(620, 470, 140),
		oval(470, 300, 80, 28),
		oval(770, 300, 80, 28),
		open([470, 328], [490, 440]),
		open([770, 328], [750, 440]),
		oval(900, 210, 70, 14),
		open([900, 224], [900, 580]),
		oval(240, 500, 70, 20),
		open([190, 515], [160, 620]),
		open([290, 515], [320, 620]),
		open([100, 640], [950, 640])
	],
	// Only the guitar shape, strings and neck; fill it with flowers.
	'Draw a guitar made of flowers': [
		[
			['M', 500, 250],
			['C', 600, 250, 640, 330, 580, 400],
			['C', 700, 440, 700, 640, 500, 650],
			['C', 300, 640, 300, 440, 420, 400],
			['C', 360, 330, 400, 250, 500, 250],
			['Z']
		],
		circle(500, 490, 45),
		open([470, 230], [470, 70]),
		open([530, 230], [530, 70]),
		rect(450, 20, 100, 55)
	],
	// A goal, the pitch line and rain clouds; the players are for you.
	'Draw a soccer game in the rain': [
		open([590, 600], [590, 350], [930, 350], [930, 600]),
		open([650, 350], [650, 600]),
		open([710, 350], [710, 600]),
		open([770, 350], [770, 600]),
		open([830, 350], [830, 600]),
		open([590, 450], [930, 450]),
		open([0, 620], [1000, 620]),
		hump(100, 400, 170, 90),
		hump(600, 900, 150, 80),
		open([180, 210], [165, 250]),
		open([260, 210], [245, 250]),
		open([700, 190], [685, 230])
	],
	// The hoop, backboard and post; add the sun and the players.
	'Draw a basketball hoop on a sunny day': [
		rect(620, 120, 220, 150),
		rect(690, 170, 80, 60),
		oval(730, 290, 60, 14),
		open([670, 295], [695, 400], [765, 400], [790, 295]),
		open([730, 304], [730, 400]),
		open([870, 270], [870, 620]),
		open([840, 200], [870, 200]),
		open([0, 620], [1000, 620])
	],
	// A big slope and two empty sleds; riders are yours.
	'Draw a snowy hill with sleds': [
		hump(0, 1000, 640, 400),
		open([260, 390], [350, 370]),
		open([270, 420], [360, 400]),
		open([600, 330], [690, 340]),
		open([610, 360], [700, 370])
	],
	// Rain clouds, drops and puddles; the umbrella is for you.
	'Draw an umbrella on a rainy day': [
		hump(100, 450, 180, 90),
		hump(450, 900, 160, 100),
		open([180, 240], [165, 290]),
		open([300, 240], [285, 290]),
		open([560, 220], [545, 270]),
		open([700, 220], [685, 270]),
		open([800, 220], [785, 270]),
		oval(300, 630, 130, 25),
		oval(750, 640, 100, 20),
		open([0, 600], [1000, 600])
	],
	// The hat's brim and crown, open on top; grow the garden.
	'Draw a hat with a whole garden on top': [
		oval(500, 540, 340, 75),
		open([390, 520], [400, 340]),
		open([610, 520], [600, 340]),
		oval(500, 340, 100, 26),
		open([394, 450], [606, 450])
	],
	// An empty round bowl with pebbles; the fish is yours.
	'Draw a fishbowl with a happy goldfish': [
		circle(500, 380, 240),
		oval(500, 150, 90, 20),
		circle(340, 538, 18),
		circle(420, 560, 16),
		circle(570, 565, 20),
		circle(650, 520, 16),
		open([170, 625], [830, 625]),
		open([480, 600], [470, 520], [495, 450])
	],
	// A fence, rows and vines; plant the pumpkins.
	'Draw a pumpkin patch in the fall': [
		open([0, 330], [1000, 330]),
		open([0, 380], [1000, 380]),
		rect(100, 280, 24, 150),
		rect(400, 280, 24, 150),
		rect(700, 280, 24, 150),
		hump(0, 500, 560, 40),
		hump(500, 1000, 600, 40),
		hump(100, 800, 660, 30),
		[
			['M', 150, 520],
			['C', 200, 480, 260, 540, 300, 500]
		],
		[
			['M', 700, 540],
			['C', 750, 500, 800, 560, 860, 520]
		]
	],
	// The fireplace, mantel and hooks; hang the stockings.
	'Draw a cozy fireplace with stockings': [
		rect(120, 190, 760, 50),
		rect(220, 240, 560, 400),
		[
			['M', 330, 640],
			['L', 330, 400],
			['C', 330, 300, 670, 300, 670, 400],
			['L', 670, 640]
		],
		oval(425, 600, 55, 20),
		oval(575, 600, 55, 20),
		open([150, 640], [850, 640]),
		circle(250, 215, 8),
		circle(500, 215, 8),
		circle(750, 215, 8)
	]
};
