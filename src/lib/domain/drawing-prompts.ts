/**
 * Daily drawing prompts (hub-cn7.27). The prompt for a day is chosen from the date alone, so every
 * device agrees; Shuffle steps to a different one. All prompts are friendly and calm.
 */
export const DRAWING_PROMPTS: readonly string[] = [
	'Draw a dragon having breakfast',
	'Draw a robot learning to dance',
	'Draw a cat wearing a space helmet',
	'Draw your dream treehouse',
	'Draw a snail racing a turtle',
	'Draw a whale carrying a tiny town on its back',
	'Draw a bear baking a giant cake',
	'Draw a rainbow with a surprise at the end',
	'Draw a dog driving a bus',
	'Draw a castle made of ice cream',
	'Draw an octopus playing every instrument',
	'Draw a penguin on a skateboard',
	'Draw a flying house with balloons',
	'Draw a friendly monster in the garden',
	'Draw a bunny exploring the moon',
	'Draw a giraffe in a very tall hat',
	'Draw a train that travels through the clouds',
	'Draw a mermaid having a picnic under the sea',
	'Draw a mouse with a tiny umbrella',
	'Draw a kite shaped like an animal',
	'Draw a pirate ship sailing on lemonade',
	'Draw a unicorn who loves to paint',
	'Draw a hedgehog wearing a scarf',
	'Draw your favorite food with a funny face',
	'Draw a bird building a cozy nest',
	'Draw a lighthouse on a sunny island',
	'Draw a puppy riding a rocket',
	'Draw an elephant doing a handstand',
	'Draw a forest where the trees are candy',
	'Draw a hot air balloon over a mountain',
	'Draw a frog having a tea party',
	'Draw a superhero who helps with chores',
	'Draw a fox reading a bedtime story',
	'Draw a farm where the animals wear hats',
	'Draw a submarine exploring a coral reef',
	'Draw a bee throwing a birthday party',
	'Draw a spaceship shaped like a banana',
	'Draw a camping trip under a million stars',
	'Draw a happy cloud with a rainy-day friend',
	'Draw a gentle giant sharing lunch',
	'Draw a koala on a bicycle',
	'Draw a sandcastle city on the beach',
	'Draw a magic door in a tree trunk',
	'Draw a snowman enjoying a summer day',
	'Draw a family of ducks crossing a bridge',
	'Draw a wizard who casts spells with glitter',
	'Draw a raccoon opening a pizza shop',
	'Draw a zoo where the animals visit people',
	'Draw a sleepy sloth in a hammock',
	'Draw a train made of animals',
	'Draw a ladybug throwing a tiny parade',
	'Draw your best friend as a superhero',
	'Draw a dinosaur learning to ride a scooter',
	'Draw a garden full of giant flowers',
	'Draw a pancake stack as tall as a house',
	'Draw a seahorse racing through seaweed',
	'Draw a family on a road trip to somewhere wonderful',
	'Draw a tiny dragon living in a teacup',
	'Draw a lion who is a gentle chef',
	'Draw a sun and moon sharing a sky',
	'Draw a squirrel with a backpack going to school',
	'Draw a playground on another planet',
	'Draw a parrot teaching a song',
	'Draw a cozy cabin in a snowy forest',
	'Draw a jellyfish wearing party lights',
	'Draw a bridge made of rainbows',
	'Draw a robot gardener growing silly vegetables'
];

/** A non-negative integer from a string (FNV-1a), stable across devices. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** Index of the prompt for a local calendar day (YYYY-MM-DD) after `shuffles` presses of Shuffle. */
export function promptIndex(date: string, shuffles = 0): number {
	const n = DRAWING_PROMPTS.length;
	const base = hash(date) % n;
	// Each shuffle moves by a step that is never 0 mod n, so the prompt always changes.
	const step = 1 + (hash(`${date}:step`) % (n - 1));
	return (
		(base + (Number.isFinite(shuffles) ? Math.max(0, Math.trunc(shuffles)) % n : 0) * step) % n
	);
}

/** The prompt text for a local calendar day and shuffle count. */
export function promptForDate(date: string, shuffles = 0): string {
	return DRAWING_PROMPTS[promptIndex(date, shuffles)];
}

/** Parses the stored on/off setting. Missing or malformed means on. */
export function parsePromptsEnabled(raw: unknown): boolean {
	return raw !== false;
}

/** Validates a PUT body: { enabled: boolean } or an error message. */
export function parsePromptsPatch(body: unknown): boolean | string {
	const enabled = (body as { enabled?: unknown } | null)?.enabled;
	return typeof enabled === 'boolean' ? enabled : 'enabled must be true or false';
}
