/**
 * Daily drawing prompts (hub-cn7.27). Each device picks the day's prompt at random and skips ones it
 * showed recently (hub-2jx); Shuffle picks another. All prompts are friendly and calm.
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
	'Draw a robot gardener growing silly vegetables',
	'Draw a turtle carrying a tiny house',
	'Draw a cow jumping over a crescent moon',
	'Draw a snail with a sparkly shell',
	'Draw a fish wearing a tiny crown',
	'Draw an owl reading by lantern light',
	'Draw a caterpillar eating a giant leaf',
	'Draw a butterfly with patterned wings',
	'Draw a whale spouting a fountain of bubbles',
	'Draw a crab building a sandcastle',
	'Draw a pig splashing in a puddle',
	'Draw a horse with a flowing mane',
	'Draw a dog chasing a ball in the park',
	'Draw a cat napping in a sunbeam',
	'Draw a bunny hiding in a garden of carrots',
	'Draw a mouse living inside a cheese house',
	'Draw a bat hanging upside down at sunset',
	'Draw a polar bear on an iceberg',
	'Draw a panda eating bamboo',
	'Draw a monkey swinging through the jungle',
	'Draw a flamingo standing on one leg',
	'Draw a peacock showing off its feathers',
	'Draw a dolphin leaping over a wave',
	'Draw a star-shaped house in the night sky',
	'Draw a castle with tall towers and flags',
	'Draw a race car with flames on the side',
	'Draw a fire truck on its way to help',
	'Draw a tractor on a busy farm',
	'Draw an airplane flying over the city',
	'Draw a helicopter rescuing a kitten',
	'Draw a sailboat on a calm lake',
	'Draw a rocket blasting off into space',
	'Draw an astronaut floating among the stars',
	'Draw an alien saying hello',
	'Draw a planet with rings and moons',
	'Draw a volcano on a tropical island',
	'Draw a waterfall in a hidden valley',
	'Draw a garden with a winding path',
	'Draw a tree with a swing',
	'Draw a big bowl of noodles',
	'Draw a birthday cake with lots of candles',
	'Draw an ice cream cone with your favorite scoops',
	'Draw a pizza with silly toppings',
	'Draw a fruit basket full of colors',
	'Draw a cupcake wearing sprinkles',
	'Draw a teddy bear picnic',
	'Draw a toy box spilling over with toys',
	'Draw a robot dog playing fetch',
	'Draw a giant sunflower taller than you',
	'Draw a mushroom house in the woods',
	'Draw a fairy riding a dragonfly',
	'Draw a knight befriending a dragon',
	'Draw a princess who fixes robots',
	'Draw a treasure chest on the ocean floor',
	'Draw a map to a secret island',
	'Draw a carousel at the fair',
	'Draw a Ferris wheel at night',
	'Draw a circus tent with a striped top',
	'Draw a musician playing the drums',
	'Draw a guitar made of flowers',
	'Draw a soccer game in the rain',
	'Draw a basketball hoop on a sunny day',
	'Draw a snowy hill with sleds',
	'Draw an umbrella on a rainy day',
	'Draw a hat with a whole garden on top',
	'Draw a fishbowl with a happy goldfish',
	'Draw a pumpkin patch in the fall',
	'Draw a cozy fireplace with stockings'
];

/** How much of the list must be seen before a prompt can come back. */
const REPEAT_AFTER = 0.75;

/** What a device remembers: the day's prompt and the ones shown recently (oldest first). */
export interface PromptMemory {
	date: string;
	prompt: string;
	recent: string[];
}

const known = new Set(DRAWING_PROMPTS);

/** Reads stored memory, dropping anything malformed or prompts no longer in the list. */
export function parsePromptMemory(raw: unknown): PromptMemory | null {
	const m = raw as Partial<PromptMemory> | null;
	if (!m || typeof m.date !== 'string' || typeof m.prompt !== 'string' || !known.has(m.prompt))
		return null;
	const recent = Array.isArray(m.recent)
		? m.recent.filter((p): p is string => typeof p === 'string' && known.has(p))
		: [];
	return { date: m.date, prompt: m.prompt, recent };
}

/**
 * A random prompt that was not shown recently: one comes back only after three quarters of the
 * list has been seen since.
 */
export function pickPrompt(recent: readonly string[], rand: () => number = Math.random): string {
	const keep = Math.floor(DRAWING_PROMPTS.length * REPEAT_AFTER);
	const avoid = new Set(recent.slice(-keep));
	// keep < length, so at least a quarter of the list is always eligible.
	const pool = DRAWING_PROMPTS.filter((p) => !avoid.has(p));
	const i = Math.min(pool.length - 1, Math.floor(Math.max(0, rand()) * pool.length));
	return pool[i];
}

/**
 * The prompt for `date` (hub-2jx): the remembered one for the same day, else a fresh random pick.
 * `shuffle` always picks a new one. The recent list is capped to what `pickPrompt` looks at.
 */
export function nextPromptMemory(
	memory: PromptMemory | null,
	date: string,
	shuffle = false,
	rand: () => number = Math.random
): PromptMemory {
	if (memory && memory.date === date && !shuffle) return memory;
	const recent = memory?.recent ?? [];
	const prompt = pickPrompt(recent, rand);
	const keep = Math.floor(DRAWING_PROMPTS.length * REPEAT_AFTER);
	return { date, prompt, recent: [...recent, prompt].slice(-keep) };
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
