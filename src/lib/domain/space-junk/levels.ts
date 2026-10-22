/**
 * Space Junk (hub-26w.5): the ten handmade levels. Difficulty climbs from one Gremlin on a
 * crate to sheltered, many-Gremlin fortresses. Every body is placed at rest (centre = support
 * top + half height) and `levels.spec.ts` proves each one settles and can be won.
 */
import type { BoxBlock, Gremlin, Level } from './level.js';
import type { MaterialId } from './materials.js';

const box = (material: MaterialId, x: number, y: number, w: number, h: number): BoxBlock => ({
	material,
	shape: 'box',
	x,
	y,
	w,
	h,
	angle: 0
});
const gremlin = (x: number, y: number): Gremlin => ({ x, y, r: 0.5 });
const level = (
	n: number,
	name: string,
	junkbots: number,
	blocks: BoxBlock[],
	gremlins: Gremlin[]
): Level => ({
	id: `junk-${n}`,
	name,
	width: 36,
	height: 20,
	anchor: { x: 4, y: 3 },
	junkbots,
	blocks,
	gremlins
});

export const LEVELS: readonly Level[] = [
	level(1, 'First Contact', 4, [box('scrap', 20, 0.5, 1, 1)], [gremlin(20, 1.5)]),
	level(
		2,
		'Glass House',
		4,
		[box('glass', 21, 1, 0.4, 2), box('glass', 24, 1, 0.4, 2), box('glass', 22.5, 2.2, 3.4, 0.4)],
		[gremlin(22.5, 0.5)]
	),
	level(
		3,
		'Scrap Stack',
		4,
		[
			box('scrap', 22, 0.75, 1.2, 1.5),
			box('scrap', 22, 2.25, 1.2, 1.5),
			box('scrap', 22, 3.75, 1.2, 1.5)
		],
		[gremlin(22, 5)]
	),
	level(
		4,
		'Tall Order',
		3,
		[box('scrap', 25, 3, 0.8, 6), box('glass', 25, 6.2, 3, 0.4)],
		[gremlin(23.8, 6.9), gremlin(26.2, 6.9)]
	),
	level(
		5,
		'Twin Towers',
		4,
		[
			box('scrap', 20, 1.5, 1, 3),
			box('glass', 20, 3.2, 2.6, 0.4),
			box('scrap', 27, 2.5, 1, 5),
			box('glass', 27, 5.2, 2.6, 0.4)
		],
		[gremlin(20, 3.9), gremlin(27, 5.9)]
	),
	level(
		6,
		'Rock Roof',
		3,
		[box('scrap', 23, 1.5, 0.6, 3), box('scrap', 27, 1.5, 0.6, 3), box('rock', 25, 3.2, 5, 0.4)],
		[gremlin(25, 0.5)]
	),
	level(
		7,
		'Glass Bridge',
		3,
		[
			box('scrap', 19, 2, 1, 4),
			box('scrap', 27, 2, 1, 4),
			box('glass', 23, 4.2, 9, 0.4),
			box('rock', 23, 4.9, 1.5, 1),
			box('rock', 31, 1.2, 1.4, 2.4)
		],
		[gremlin(23, 0.5), gremlin(21, 4.9), gremlin(25.5, 4.9), gremlin(33, 0.5)]
	),
	level(
		8,
		'Rock Garden',
		3,
		[
			box('rock', 22, 1, 1.2, 2),
			box('scrap', 25, 1.5, 0.6, 3),
			box('glass', 25, 3.2, 2.2, 0.4),
			box('rock', 28, 1, 1.2, 2),
			box('scrap', 28, 2.35, 0.5, 0.7)
		],
		[gremlin(25, 3.9), gremlin(28, 3.2), gremlin(23.5, 0.5)]
	),
	level(
		9,
		'Skyscraper',
		3,
		[
			box('scrap', 24, 3, 0.8, 6),
			box('scrap', 27, 3, 0.8, 6),
			box('glass', 25.5, 6.2, 4, 0.4),
			box('scrap', 25.5, 7.4, 0.8, 2),
			box('glass', 25.5, 8.6, 2.6, 0.4),
			box('rock', 29.5, 1.1, 1, 2.2)
		],
		[gremlin(24.2, 6.9), gremlin(26.8, 6.9), gremlin(25.5, 9.3), gremlin(31.5, 0.5)]
	),
	level(
		10,
		'Grand Gremlin Fort',
		3,
		[
			box('rock', 20, 1.5, 1, 3),
			box('scrap', 23, 1.5, 0.6, 3),
			box('rock', 26, 1.5, 1, 3),
			box('glass', 21.5, 3.2, 2.6, 0.4),
			box('rock', 24.5, 3.2, 2.6, 0.4),
			box('scrap', 30, 2, 0.8, 4),
			box('glass', 30, 4.2, 2.4, 0.4)
		],
		[gremlin(21.5, 3.9), gremlin(24.5, 3.9), gremlin(22.2, 0.5), gremlin(30, 4.9)]
	)
];
