/**
 * The prompts that have a starter sketch (hub-585). Kept apart from the line art so the home page
 * bundle only carries the names; the sketches load when a Start it chip is about to show.
 * `drawing-starters.spec.ts` checks this list matches the sketches exactly.
 */
export const STARTER_PROMPTS: readonly string[] = [
	'Draw a dog driving a bus',
	'Draw a flying house with balloons',
	'Draw a castle made of ice cream',
	'Draw a penguin on a skateboard',
	'Draw a lighthouse on a sunny island',
	'Draw a hot air balloon over a mountain',
	'Draw a giraffe in a very tall hat',
	'Draw a pirate ship sailing on lemonade',
	'Draw a koala on a bicycle',
	'Draw a snowman enjoying a summer day',
	'Draw a magic door in a tree trunk',
	'Draw a cozy cabin in a snowy forest',
	'Draw a submarine exploring a coral reef',
	'Draw a pancake stack as tall as a house',
	'Draw a train that travels through the clouds'
];

const names = new Set(STARTER_PROMPTS);

/** Whether the prompt has a starter sketch. */
export const hasStarter = (prompt: string): boolean => names.has(prompt);
