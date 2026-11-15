/**
 * Fold-the-paper monster (hub-t27j.9): a pass-the-drawing game on one shared board. The board is
 * split into horizontal bands (head, body, legs, and optionally feet). On each turn only the current
 * band is drawable; everything above it is covered except a thin strip at the bottom of the previous
 * band, so the next player can carry the neck or waist lines across. After the last turn the
 * players reveal the whole monster.
 *
 * Pure: band geometry and the turn state machine, no canvas and no DOM.
 */
export const MONSTER_PARTS = ['Head', 'Body', 'Legs', 'Feet'] as const;
export const MONSTER_TURN_OPTIONS = [3, 4] as const;
export type MonsterTurns = (typeof MONSTER_TURN_OPTIONS)[number];

/** The strip of the previous band left showing, as a fraction of one band's height. */
export const STRIP_FRACTION = 0.14;

export interface MonsterGame {
	turns: MonsterTurns;
	/** 0-based index of the band being drawn. */
	turn: number;
	phase: 'drawing' | 'revealed';
}

export interface Span {
	top: number;
	height: number;
}

export const isMonsterTurns = (v: unknown): v is MonsterTurns =>
	(MONSTER_TURN_OPTIONS as readonly unknown[]).includes(v);

/** A game from any input: anything but 3 or 4 turns is a 3-turn game. */
export const startMonster = (turns?: unknown): MonsterGame => ({
	turns: isMonsterTurns(turns) ? turns : 3,
	turn: 0,
	phase: 'drawing'
});

/** Whether `v` is a well-formed game (for anything read back from storage or a peer). */
export function isMonsterGame(v: unknown): v is MonsterGame {
	if (typeof v !== 'object' || v === null) return false;
	const g = v as Record<string, unknown>;
	return (
		isMonsterTurns(g.turns) &&
		Number.isInteger(g.turn) &&
		(g.turn as number) >= 0 &&
		(g.turn as number) < g.turns &&
		(g.phase === 'drawing' || g.phase === 'revealed')
	);
}

export const isDrawing = (g: MonsterGame | null): g is MonsterGame =>
	g !== null && g.phase === 'drawing';

export const isLastTurn = (g: MonsterGame): boolean => g.turn === g.turns - 1;

/** "Next player" is offered on every turn but the last, while drawing. */
export const canNext = (g: MonsterGame): boolean => g.phase === 'drawing' && !isLastTurn(g);

/** "Reveal!" replaces it on the last turn. */
export const canReveal = (g: MonsterGame): boolean => g.phase === 'drawing' && isLastTurn(g);

export const nextPlayer = (g: MonsterGame): MonsterGame =>
	canNext(g) ? { ...g, turn: g.turn + 1 } : g;

export const reveal = (g: MonsterGame): MonsterGame =>
	canReveal(g) ? { ...g, phase: 'revealed' } : g;

export const partName = (g: MonsterGame): string => MONSTER_PARTS[g.turn] ?? 'Monster';

/** What the status line says: whose part, and what is left. */
export function turnLabel(g: MonsterGame): string {
	if (g.phase === 'revealed') return 'Ta-da! Here is your monster';
	return `Player ${g.turn + 1} of ${g.turns}: draw the ${partName(g).toLowerCase()}`;
}

const valid = (h: number): number => (Number.isFinite(h) && h > 0 ? h : 0);

/** The band of board height `h` that turn `turn` draws in. */
export function bandSpan(turns: number, turn: number, h: number): Span {
	const board = valid(h);
	const band = board / Math.max(1, turns);
	const i = Math.min(Math.max(Math.trunc(turn) || 0, 0), Math.max(1, turns) - 1);
	return { top: band * i, height: band };
}

/** The drawable band of a game in play, or null once revealed. */
export const currentBand = (g: MonsterGame, h: number): Span | null =>
	g.phase === 'drawing' ? bandSpan(g.turns, g.turn, h) : null;

/** The cover over everything above the previous band's bottom strip; null when nothing is covered. */
export function coverSpan(g: MonsterGame, h: number): Span | null {
	if (g.phase !== 'drawing' || g.turn === 0) return null;
	const band = bandSpan(g.turns, g.turn, h);
	const height = band.top - band.height * STRIP_FRACTION;
	return height > 0 ? { top: 0, height } : null;
}

/** Whether a board y is inside the band being drawn (always true once revealed). */
export function inBand(g: MonsterGame, y: number, h: number): boolean {
	const b = currentBand(g, h);
	return b === null || (y >= b.top && y <= b.top + b.height);
}

/** Pull a y into the current band so ink never leaves it; unchanged once revealed. */
export function clampToBand(g: MonsterGame, y: number, h: number): number {
	const b = currentBand(g, h);
	if (b === null || b.height === 0) return y;
	return Math.min(Math.max(y, b.top), b.top + b.height);
}
