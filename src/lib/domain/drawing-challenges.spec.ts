import { describe, expect, it } from 'vitest';
import {
	CHALLENGE_MAX_COUNT,
	CHALLENGE_MAX_LENGTH,
	clearForMember,
	parseChallengeInput,
	parseChallenges,
	removeChallenge,
	setChallenge,
	visibleChallenges
} from './drawing-challenges.js';

const c = (id: string, memberId: string, text = 'Draw dinner') => ({ id, memberId, text });

describe('parseChallenges', () => {
	it('keeps good entries and tidies the text', () => {
		expect(parseChallenges([{ id: 'a', memberId: 'k1', text: '  Draw   a  pie ' }])).toEqual([
			c('a', 'k1', 'Draw a pie')
		]);
	});
	it('drops junk, empty, overlong and repeated-kid entries', () => {
		const list = parseChallenges([
			null,
			'x',
			{ id: 'a', memberId: 'k1', text: 'ok' },
			{ id: 'b', memberId: 'k1', text: 'second for the same kid' },
			{ id: '', memberId: 'k2', text: 'no id' },
			{ id: 'c', memberId: '', text: 'no kid' },
			{ id: 'd', memberId: 'k3', text: '   ' },
			{ id: 'e', memberId: 'k4', text: 'x'.repeat(CHALLENGE_MAX_LENGTH + 1) },
			{ id: 'f', memberId: 'k5', text: 7 }
		]);
		expect(list).toEqual([c('a', 'k1', 'ok')]);
	});
	it('is empty for anything that is not a list', () => {
		for (const v of [null, undefined, 'x', 3, {}]) expect(parseChallenges(v)).toEqual([]);
	});
	it('caps the list', () => {
		const many = Array.from({ length: 30 }, (_, i) => c(`i${i}`, `k${i}`));
		expect(parseChallenges(many)).toHaveLength(CHALLENGE_MAX_COUNT);
	});
});

describe('parseChallengeInput', () => {
	it('accepts a kid and text', () => {
		expect(parseChallengeInput({ memberId: 'k1', text: ' Draw dinner ' })).toEqual({
			memberId: 'k1',
			text: 'Draw dinner'
		});
	});
	it('explains what is wrong', () => {
		expect(parseChallengeInput(null)).toMatch(/memberId/);
		expect(parseChallengeInput({ memberId: 3, text: 'x' })).toMatch(/memberId/);
		expect(parseChallengeInput({ memberId: 'k1' })).toMatch(/text is required/);
		expect(parseChallengeInput({ memberId: 'k1', text: '  ' })).toMatch(/text is required/);
		expect(parseChallengeInput({ memberId: 'k1', text: 'x'.repeat(81) })).toMatch(/80/);
	});
});

describe('list changes', () => {
	it('setChallenge replaces the same kid and keeps others', () => {
		const list = setChallenge([c('a', 'k1'), c('b', 'k2')], c('z', 'k1', 'new'));
		expect(list).toEqual([c('b', 'k2'), c('z', 'k1', 'new')]);
	});
	it('setChallenge never grows past the cap', () => {
		let list = Array.from({ length: CHALLENGE_MAX_COUNT }, (_, i) => c(`i${i}`, `k${i}`));
		list = setChallenge(list, c('n', 'new'));
		expect(list).toHaveLength(CHALLENGE_MAX_COUNT);
		expect(list.at(-1)?.id).toBe('n');
	});
	it('removeChallenge and clearForMember', () => {
		const list = [c('a', 'k1'), c('b', 'k2')];
		expect(removeChallenge(list, 'a')).toEqual([c('b', 'k2')]);
		expect(removeChallenge(list, 'nope')).toEqual(list);
		expect(clearForMember(list, 'k2')).toEqual([c('a', 'k1')]);
		expect(clearForMember(list, 'nobody')).toEqual(list);
	});
	it('visibleChallenges skips kids not on the board', () => {
		expect(visibleChallenges([c('a', 'k1'), c('b', 'gone')], [{ id: 'k1' }])).toEqual([
			c('a', 'k1')
		]);
		expect(visibleChallenges([c('a', 'k1')], [])).toEqual([]);
	});
});
