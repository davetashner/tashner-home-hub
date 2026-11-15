import { describe, expect, it } from 'vitest';
import {
	GUESS_DROP_MS,
	GUESS_WORDS,
	dropped,
	guess,
	makeChoices,
	newer,
	parsePublicRound,
	pickWord,
	publicRound,
	shuffle,
	startRound,
	touch,
	isPlayerId,
	markRewarded,
	rewardMembers,
	setPlayer
} from './drawing-guess.js';

const seq = (...n: number[]) => {
	let i = 0;
	return () => n[i++ % n.length];
};

describe('words and choices', () => {
	it('has plenty of unique short words', () => {
		expect(new Set(GUESS_WORDS).size).toBe(GUESS_WORDS.length);
		expect(GUESS_WORDS.length).toBeGreaterThanOrEqual(40);
	});
	it('shuffle keeps every item and does not touch the input', () => {
		const a = [1, 2, 3, 4, 5];
		const s = shuffle(a, seq(0.9, 0.1, 0.5, 0.3));
		expect([...s].sort()).toEqual(a);
		expect(a).toEqual([1, 2, 3, 4, 5]);
		expect(shuffle(a, () => 1)).toHaveLength(5);
	});
	it('pickWord skips recent words and survives an exhausted pool', () => {
		expect(pickWord(GUESS_WORDS.slice(1), () => 0)).toBe(GUESS_WORDS[0]);
		expect(GUESS_WORDS).toContain(pickWord(GUESS_WORDS, () => 0.999));
		expect(pickWord([], () => 1)).toBe(GUESS_WORDS[GUESS_WORDS.length - 1]);
	});
	it('makeChoices gives four distinct choices including the word', () => {
		for (let i = 0; i < 30; i++) {
			const c = makeChoices('cat');
			expect(c).toHaveLength(4);
			expect(new Set(c).size).toBe(4);
			expect(c).toContain('cat');
		}
	});
});

describe('rounds', () => {
	const r1 = startRound(null, 'A', 1000, seq(0.1, 0.2, 0.3));
	it('starts with the caller drawing and nobody guessing', () => {
		expect(r1).toMatchObject({
			round: 1,
			drawer: 'A',
			guesser: null,
			status: 'drawing',
			wrongs: 0
		});
		expect(r1.choices).toContain(r1.word);
		expect(r1.recent).toEqual([r1.word]);
	});
	it('the public view hides the word until it is solved', () => {
		expect(publicRound(r1).word).toBeUndefined();
		expect(JSON.stringify(publicRound(r1))).not.toContain('"word"');
		const solved = guess(touch(r1, 'B', 1100), 'B', r1.choices.indexOf(r1.word)).round;
		expect(publicRound(solved).word).toBe(r1.word);
	});
	it('the first other board that checks in becomes the guesser', () => {
		const t = touch(r1, 'B', 2000);
		expect(t.guesser).toBe('B');
		expect(t.v).toBe(r1.v + 1);
		expect(touch(t, 'C', 2100).guesser).toBe('B');
		const again = touch(r1, 'A', 2000);
		expect(again.guesser).toBeNull();
		expect(again.v).toBe(r1.v);
	});
	it('a right pick solves, a wrong one counts and keeps going', () => {
		const t = touch(r1, 'B', 1100);
		const wrongIdx = r1.choices.findIndex((c) => c !== r1.word);
		const w = guess(t, 'B', wrongIdx);
		expect(w.result).toBe('wrong');
		expect(w.round).toMatchObject({ wrongs: 1, status: 'drawing' });
		const right = guess(w.round, 'B', r1.choices.indexOf(r1.word));
		expect(right.result).toBe('right');
		expect(right.round.status).toBe('solved');
	});
	it('ignores the drawer, bad indexes, and guesses after solving', () => {
		const idx = r1.choices.indexOf(r1.word);
		expect(guess(r1, 'A', idx).result).toBe('ignored');
		for (const bad of [-1, 4, 1.5, '1', null, undefined, NaN])
			expect(guess(r1, 'B', bad).result).toBe('ignored');
		const solved = guess(r1, 'B', idx).round;
		expect(guess(solved, 'B', idx).result).toBe('ignored');
	});
	it('a wrong guess from a new board makes it the guesser', () => {
		const wrongIdx = r1.choices.findIndex((c) => c !== r1.word);
		expect(guess(r1, 'B', wrongIdx).round.guesser).toBe('B');
	});
	it('a new round swaps roles and avoids the last word', () => {
		const solved = guess(touch(r1, 'B', 1100), 'B', r1.choices.indexOf(r1.word)).round;
		const r2 = startRound(solved, 'A', 3000, () => 0);
		expect(r2).toMatchObject({ round: 2, drawer: 'B', guesser: 'A', status: 'drawing' });
		expect(r2.word).not.toBe(r1.word);
		expect(r2.recent).toEqual([r1.word, r2.word]);
		expect(r2.v).toBeGreaterThan(solved.v);
	});
	it('a new round with no guesser keeps the caller drawing', () => {
		expect(startRound(r1, 'A', 3000).drawer).toBe('A');
		const other = startRound(r1, 'B', 3000);
		expect(other).toMatchObject({ drawer: 'B', guesser: 'A' });
	});
	it('remembers only the last dozen words', () => {
		let r = r1;
		for (let i = 0; i < 20; i++) r = startRound(r, 'A', 0);
		expect(r.recent.length).toBe(12);
	});
});

describe('drops', () => {
	const r = touch(startRound(null, 'A', 0), 'B', 0);
	it('is fine while both check in', () => {
		expect(dropped(r, GUESS_DROP_MS)).toBe(false);
		expect(dropped(touch(touch(r, 'A', 9000), 'B', 9000), 10_000)).toBe(false);
	});
	it('ends when either player goes quiet', () => {
		expect(dropped(touch(r, 'A', 20_000), 20_000)).toBe(true);
		expect(dropped(touch(r, 'B', 20_000), 20_000)).toBe(true);
	});
	it('waits for a guesser that has not appeared yet only on the drawer', () => {
		const lone = startRound(null, 'A', 0);
		expect(dropped(lone, 1000)).toBe(false);
		expect(dropped(lone, GUESS_DROP_MS + 1)).toBe(true);
	});
});

describe('wire form', () => {
	const pub = publicRound(touch(startRound(null, 'A', 0), 'B', 0));
	it('round-trips', () => {
		expect(parsePublicRound(JSON.parse(JSON.stringify(pub)))).toEqual(pub);
		const solved = { ...pub, status: 'solved', word: 'cat' };
		expect(parsePublicRound(solved)?.word).toBe('cat');
	});
	it('rejects malformed input', () => {
		for (const bad of [
			null,
			'x',
			42,
			{},
			{ ...pub, v: -1 },
			{ ...pub, round: 1.5 },
			{ ...pub, drawer: '' },
			{ ...pub, drawer: 'x'.repeat(65) },
			{ ...pub, guesser: 5 },
			{ ...pub, status: 'won' },
			{ ...pub, choices: ['a', 'b', 'c'] },
			{ ...pub, choices: ['a', 'b', 'c', 7] },
			{ ...pub, word: 5 }
		])
			expect(parsePublicRound(bad)).toBeNull();
	});
	it('newer never rolls a board back', () => {
		const a = { ...pub, v: 3 };
		expect(newer(null, a)).toBe(a);
		expect(newer(a, { ...a, v: 2 })).toBe(a);
		const b = { ...a, v: 4 };
		expect(newer(a, b)).toBe(b);
		const nextRound = { ...a, round: 2, v: 1 };
		expect(newer(a, nextRound)).toBe(nextRound);
		expect(newer(nextRound, a)).toBe(nextRound);
	});
});

describe('players and rewards (hub-t27j.25)', () => {
	const solved = () => {
		let r = startRound(null, 'a', 0, seq(0.1));
		r = touch(r, 'b', 1);
		r = setPlayer(setPlayer(r, 'a', 'kidA'), 'b', 'kidB');
		return { ...r, status: 'solved' as const };
	};
	it('isPlayerId accepts short strings only', () => {
		expect(isPlayerId('kid')).toBe(true);
		for (const bad of ['', 'x'.repeat(65), 4, null, undefined]) expect(isPlayerId(bad)).toBe(false);
	});
	it('setPlayer remembers a pick and ignores junk or repeats', () => {
		const r = startRound(null, 'a', 0, seq(0.1));
		const s = setPlayer(r, 'a', 'kidA');
		expect(s.players).toEqual({ a: 'kidA' });
		expect(setPlayer(s, 'a', 'kidA')).toBe(s);
		expect(setPlayer(s, 'a', 7)).toBe(s);
		expect(setPlayer(s, 'a', '')).toBe(s);
	});
	it('rewards both players once solved, and only once', () => {
		const r = solved();
		expect(rewardMembers(r)).toEqual(['kidA', 'kidB']);
		const paid = markRewarded(r, 2);
		expect(rewardMembers(paid)).toEqual([]);
		expect(publicRound(paid).stars).toBe(2);
	});
	it('rewards nothing before solved, and a kid on both boards once', () => {
		const r = solved();
		expect(rewardMembers({ ...r, status: 'drawing' })).toEqual([]);
		expect(rewardMembers({ ...r, players: { a: 'kidA', b: 'kidA' } })).toEqual(['kidA']);
		expect(rewardMembers({ ...r, players: { a: 'kidA' } })).toEqual(['kidA']);
		expect(rewardMembers({ ...r, players: {} })).toEqual([]);
	});
	it('a new round keeps who is playing but not the reward', () => {
		const next = startRound(markRewarded(solved(), 2), 'a', 5, seq(0.5));
		expect(next.players).toEqual({ a: 'kidA', b: 'kidB' });
		expect(next.rewarded).toBe(false);
		expect(publicRound(next).stars).toBeUndefined();
	});
	it('parses the optional stars field', () => {
		const pub = publicRound({ ...solved(), stars: 2 });
		expect(parsePublicRound(pub)?.stars).toBe(2);
		expect(parsePublicRound({ ...pub, stars: -1 })).toBeNull();
		expect(parsePublicRound({ ...pub, stars: 'x' })).toBeNull();
	});
});
