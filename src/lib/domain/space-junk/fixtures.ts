/** Synthetic levels for the Space Junk tests (hub-26w.1). */
import type { Level } from './level.js';

/** Two scrap pillars, a glass beam and one Gremlin on top. */
export const TEST_TOWER: Level = {
	id: 'test-tower',
	name: 'Test tower',
	width: 30,
	height: 15,
	anchor: { x: 4, y: 3 },
	junkbots: 3,
	blocks: [
		{ material: 'scrap', shape: 'box', x: 19, y: 1, w: 0.5, h: 2, angle: 0 },
		{ material: 'scrap', shape: 'box', x: 21, y: 1, w: 0.5, h: 2, angle: 0 },
		{ material: 'glass', shape: 'box', x: 20, y: 2.2, w: 3, h: 0.4, angle: 0 }
	],
	gremlins: [{ x: 20, y: 2.9, r: 0.5 }]
};
