import { describe, expect, it } from 'vitest';
import {
	STRIP_FRACTION,
	bandSpan,
	canNext,
	canReveal,
	clampToBand,
	coverSpan,
	currentBand,
	inBand,
	isDrawing,
	isLastTurn,
	isMonsterGame,
	nextPlayer,
	partName,
	reveal,
	startMonster,
	turnLabel
} from './drawing-monster.js';

describe('startMonster', () => {
	it('starts a 3 or 4 turn game on the first band', () => {
		expect(startMonster(3)).toEqual({ turns: 3, turn: 0, phase: 'drawing' });
		expect(startMonster(4).turns).toBe(4);
	});
	it('falls back to 3 turns for anything else', () => {
		for (const bad of [undefined, 2, 5, '4', null, NaN]) expect(startMonster(bad).turns).toBe(3);
	});
});

describe('turn state machine', () => {
	it('walks head, body, legs, then reveals', () => {
		let g = startMonster(3);
		expect(canNext(g)).toBe(true);
		expect(canReveal(g)).toBe(false);
		g = nextPlayer(g);
		g = nextPlayer(g);
		expect(g.turn).toBe(2);
		expect(isLastTurn(g)).toBe(true);
		expect(canNext(g)).toBe(false);
		expect(canReveal(g)).toBe(true);
		expect(nextPlayer(g)).toBe(g);
		g = reveal(g);
		expect(g.phase).toBe('revealed');
		expect(canReveal(g)).toBe(false);
		expect(nextPlayer(g)).toBe(g);
		expect(reveal(g)).toBe(g);
	});
	it('cannot reveal early', () => {
		const g = startMonster(4);
		expect(reveal(g)).toBe(g);
		expect(isLastTurn(nextPlayer(nextPlayer(g)))).toBe(false);
	});
	it('isDrawing is false for null and revealed games', () => {
		expect(isDrawing(null)).toBe(false);
		expect(isDrawing(startMonster())).toBe(true);
		expect(isDrawing({ ...startMonster(), phase: 'revealed' })).toBe(false);
	});
	it('labels the turns', () => {
		expect(partName(startMonster(4))).toBe('Head');
		expect(partName({ turns: 4, turn: 3, phase: 'drawing' })).toBe('Feet');
		expect(partName({ turns: 3, turn: 9, phase: 'drawing' })).toBe('Monster');
		expect(turnLabel(startMonster(3))).toBe('Player 1 of 3: draw the head');
		expect(turnLabel({ turns: 3, turn: 2, phase: 'revealed' })).toMatch(/Ta-da/);
	});
});

describe('bands and cover', () => {
	it('splits the board into equal bands', () => {
		expect(bandSpan(3, 0, 900)).toEqual({ top: 0, height: 300 });
		expect(bandSpan(3, 2, 900)).toEqual({ top: 600, height: 300 });
		expect(bandSpan(4, 3, 800)).toEqual({ top: 600, height: 200 });
	});
	it('tolerates malformed input', () => {
		expect(bandSpan(3, -1, 900).top).toBe(0);
		expect(bandSpan(3, 99, 900).top).toBe(600);
		expect(bandSpan(3, NaN, 900).top).toBe(0);
		expect(bandSpan(0, 0, 900)).toEqual({ top: 0, height: 900 });
		expect(bandSpan(3, 1, NaN)).toEqual({ top: 0, height: 0 });
		expect(bandSpan(3, 1, -5).height).toBe(0);
	});
	it('covers everything above the previous band bottom strip', () => {
		const g = nextPlayer(startMonster(3));
		const strip = 300 * STRIP_FRACTION;
		expect(coverSpan(g, 900)).toEqual({ top: 0, height: 300 - strip });
		const g3 = nextPlayer(g);
		expect(coverSpan(g3, 900)).toEqual({ top: 0, height: 600 - strip });
	});
	it('covers nothing on the first turn, after the reveal, or on a zero-height board', () => {
		expect(coverSpan(startMonster(), 900)).toBeNull();
		expect(coverSpan({ turns: 3, turn: 2, phase: 'revealed' }, 900)).toBeNull();
		expect(coverSpan(nextPlayer(startMonster()), 0)).toBeNull();
	});
	it('leaves a strip of the previous band showing', () => {
		const g = nextPlayer(startMonster(3));
		const cover = coverSpan(g, 900)!;
		const prev = bandSpan(3, 0, 900);
		const visible = prev.top + prev.height - (cover.top + cover.height);
		expect(visible).toBeGreaterThan(0);
		expect(visible).toBeLessThan(prev.height);
	});
	it('currentBand is null once revealed', () => {
		expect(currentBand({ turns: 3, turn: 2, phase: 'revealed' }, 900)).toBeNull();
		expect(currentBand(startMonster(), 900)).toEqual({ top: 0, height: 300 });
	});
});

describe('ink limits', () => {
	const g = nextPlayer(startMonster(3));
	it('knows which y values are in the band', () => {
		expect(inBand(g, 450, 900)).toBe(true);
		expect(inBand(g, 300, 900)).toBe(true);
		expect(inBand(g, 100, 900)).toBe(false);
		expect(inBand(g, 700, 900)).toBe(false);
		expect(inBand({ ...g, phase: 'revealed' }, 100, 900)).toBe(true);
	});
	it('clamps ink into the band', () => {
		expect(clampToBand(g, 100, 900)).toBe(300);
		expect(clampToBand(g, 450, 900)).toBe(450);
		expect(clampToBand(g, 800, 900)).toBe(600);
		expect(clampToBand({ ...g, phase: 'revealed' }, 800, 900)).toBe(800);
		expect(clampToBand(g, 50, 0)).toBe(50);
	});
});

describe('isMonsterGame', () => {
	it('accepts a real game and rejects junk', () => {
		expect(isMonsterGame(startMonster())).toBe(true);
		for (const bad of [
			null,
			'x',
			{},
			{ turns: 5, turn: 0, phase: 'drawing' },
			{ turns: 3, turn: 3, phase: 'drawing' },
			{ turns: 3, turn: -1, phase: 'drawing' },
			{ turns: 3, turn: 1.5, phase: 'drawing' },
			{ turns: 3, turn: 0, phase: 'oops' }
		])
			expect(isMonsterGame(bad)).toBe(false);
	});
});
