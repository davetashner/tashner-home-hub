/**
 * Draw and guess between two boards (hub-t27j.10): the pure rules. One board draws a secret
 * word on the live share; the other sees the strokes and four big choices (the word plus three
 * decoys) and taps its guess. The server keeps the full `Round` (it alone knows the word),
 * checks guesses, and broadcasts only the `PublicRound`, which carries the word once it is
 * solved. A round ends cleanly when either player stops pinging, so a dropped device never
 * leaves the other board stuck.
 */

/** Short, friendly, easy-to-draw words. */
export const GUESS_WORDS: readonly string[] = [
	'cat',
	'dog',
	'fish',
	'bird',
	'horse',
	'cow',
	'pig',
	'duck',
	'frog',
	'bee',
	'snail',
	'turtle',
	'whale',
	'penguin',
	'bunny',
	'bear',
	'lion',
	'monkey',
	'owl',
	'spider',
	'house',
	'car',
	'bus',
	'train',
	'boat',
	'plane',
	'rocket',
	'bike',
	'castle',
	'tent',
	'sun',
	'moon',
	'star',
	'cloud',
	'rainbow',
	'tree',
	'flower',
	'mountain',
	'umbrella',
	'snowman',
	'apple',
	'banana',
	'pizza',
	'cake',
	'cookie',
	'ice cream',
	'carrot',
	'egg',
	'cheese',
	'cupcake',
	'ball',
	'kite',
	'robot',
	'balloon',
	'hat',
	'shoe',
	'clock',
	'key',
	'book',
	'guitar'
];

export const GUESS_CHOICES = 4;
/** A player silent for this long has dropped; the round ends. */
export const GUESS_DROP_MS = 8_000;
/** How often each board checks in. */
export const GUESS_PING_MS = 2_000;
/** Words kept in memory so the next round is not a repeat. */
const RECENT = 12;

export type RoundStatus = 'drawing' | 'solved';

/** Server side: everything, including the secret. */
export interface Round {
	/** Counts every change, so a board can ignore an older state arriving late. */
	v: number;
	round: number;
	drawer: string;
	/** The first other board to check in; null until one does. */
	guesser: string | null;
	word: string;
	choices: string[];
	status: RoundStatus;
	/** Wrong guesses so far this round. */
	wrongs: number;
	lastSeen: Record<string, number>;
	recent: string[];
	/** Which household member is on each board (author id -> member id), for star rewards. */
	players: Record<string, string>;
	/** Stars were handed out for this round already (once per solved round). */
	rewarded: boolean;
	/** How many kids got a star for this round. */
	stars: number;
}

/** What every board may see: the word only once it is solved. */
export interface PublicRound {
	v: number;
	round: number;
	drawer: string;
	guesser: string | null;
	choices: string[];
	status: RoundStatus;
	wrongs: number;
	word?: string;
	/** Kids who earned a star for this solved round (omitted when none). */
	stars?: number;
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.min(i, Math.floor(rand() * (i + 1)));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/** A word not used recently (falls back to any word when the pool is exhausted). */
export function pickWord(recent: readonly string[], rand: () => number = Math.random): string {
	const fresh = GUESS_WORDS.filter((w) => !recent.includes(w));
	const pool = fresh.length > 0 ? fresh : GUESS_WORDS;
	return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/** The word plus three different decoys, shuffled. */
export function makeChoices(word: string, rand: () => number = Math.random): string[] {
	const decoys = shuffle(
		GUESS_WORDS.filter((w) => w !== word),
		rand
	).slice(0, GUESS_CHOICES - 1);
	return shuffle([word, ...decoys], rand);
}

/**
 * Begins a round. The first round's drawer is `caller`; a new round hands the drawing to the
 * previous guesser (roles swap), falling back to `caller` when nobody guessed yet.
 */
export function startRound(
	prev: Round | null,
	caller: string,
	now: number,
	rand: () => number = Math.random
): Round {
	const drawer = prev?.guesser ?? caller;
	const recent = prev ? prev.recent : [];
	const word = pickWord(recent, rand);
	return {
		v: (prev?.v ?? 0) + 1,
		round: (prev?.round ?? 0) + 1,
		drawer,
		guesser: prev ? (prev.drawer === drawer ? null : prev.drawer) : null,
		word,
		choices: makeChoices(word, rand),
		status: 'drawing',
		wrongs: 0,
		lastSeen: {
			[drawer]: now,
			...(prev?.drawer && prev.drawer !== drawer ? { [prev.drawer]: now } : {})
		},
		recent: [...recent, word].slice(-RECENT),
		players: { ...prev?.players },
		rewarded: false,
		stars: 0
	};
}

/** Who is playing on a board: a short member id string, otherwise ignored. */
export function isPlayerId(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

/** Remembers which member is on a board; no-op for junk or an unchanged pick. */
export function setPlayer(r: Round, author: string, member: unknown): Round {
	if (!isPlayerId(member) || r.players[author] === member) return r;
	return { ...r, players: { ...r.players, [author]: member } };
}

/**
 * The distinct members to reward for a solved round: the drawer's and the guesser's picks, once
 * each (a kid on both boards still earns one star). Empty until solved or once already rewarded.
 */
export function rewardMembers(r: Round): string[] {
	if (r.status !== 'solved' || r.rewarded) return [];
	const picks = [r.drawer, r.guesser].flatMap((a) => (a && r.players[a] ? [r.players[a]] : []));
	return [...new Set(picks)];
}

/** Marks the round rewarded with the number of kids who earned a star. */
export const markRewarded = (r: Round, stars: number): Round => ({
	...r,
	v: r.v + 1,
	rewarded: true,
	stars
});

export const publicRound = (r: Round): PublicRound => ({
	v: r.v,
	round: r.round,
	drawer: r.drawer,
	guesser: r.guesser,
	choices: [...r.choices],
	status: r.status,
	wrongs: r.wrongs,
	...(r.status === 'solved' ? { word: r.word } : {}),
	...(r.stars > 0 ? { stars: r.stars } : {})
});

/** A board checked in. The first board other than the drawer becomes the guesser. */
export function touch(r: Round, author: string, now: number): Round {
	const lastSeen = { ...r.lastSeen, [author]: now };
	if (author !== r.drawer && r.guesser === null)
		return { ...r, v: r.v + 1, guesser: author, lastSeen };
	return { ...r, lastSeen };
}

/** True when the drawer or an assigned guesser has gone quiet. */
export function dropped(r: Round, now: number): boolean {
	return [r.drawer, r.guesser].some(
		(p) => p !== null && now - (r.lastSeen[p] ?? 0) > GUESS_DROP_MS
	);
}

export type GuessResult = 'right' | 'wrong' | 'ignored';

/** Checks a guess by choice index. Only the guesser may guess, and only while drawing. */
export function guess(
	r: Round,
	author: string,
	index: unknown
): { round: Round; result: GuessResult } {
	const ok =
		author !== r.drawer &&
		r.status === 'drawing' &&
		typeof index === 'number' &&
		Number.isInteger(index) &&
		index >= 0 &&
		index < r.choices.length;
	if (!ok) return { round: r, result: 'ignored' };
	if (r.choices[index as number] === r.word)
		return { round: { ...r, v: r.v + 1, status: 'solved', guesser: author }, result: 'right' };
	return {
		round: { ...r, v: r.v + 1, wrongs: r.wrongs + 1, guesser: r.guesser ?? author },
		result: 'wrong'
	};
}

/** A public round from the wire, or null when malformed. */
export function parsePublicRound(raw: unknown): PublicRound | null {
	if (!raw || typeof raw !== 'object') return null;
	const p = raw as Record<string, unknown>;
	const int = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
	const str = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64;
	if (!int(p.v) || !int(p.round) || !int(p.wrongs) || !str(p.drawer)) return null;
	if (p.guesser !== null && !str(p.guesser)) return null;
	if (p.status !== 'drawing' && p.status !== 'solved') return null;
	if (!Array.isArray(p.choices) || p.choices.length !== GUESS_CHOICES || !p.choices.every(str))
		return null;
	if (p.word !== undefined && !str(p.word)) return null;
	if (p.stars !== undefined && !int(p.stars)) return null;
	return {
		v: p.v,
		round: p.round,
		drawer: p.drawer,
		guesser: p.guesser as string | null,
		choices: p.choices as string[],
		status: p.status,
		wrongs: p.wrongs,
		...(p.word !== undefined ? { word: p.word } : {}),
		...(p.stars !== undefined ? { stars: p.stars } : {})
	};
}

/** The newer of two states (a late arrival never rolls a board back); `ended` clears it. */
export function newer(cur: PublicRound | null, next: PublicRound): PublicRound {
	if (!cur) return next;
	if (next.round !== cur.round) return next.round > cur.round ? next : cur;
	return next.v >= cur.v ? next : cur;
}
