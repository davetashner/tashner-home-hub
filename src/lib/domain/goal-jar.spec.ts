import { describe, expect, it } from 'vitest';
import { earnedDecision, earnedKey, jarCaption, jarFill } from './goal-jar';

describe('jarFill', () => {
	it('fills gold by approved stars and pale by approved plus waiting', () => {
		expect(jarFill(42, 8, 100)).toEqual({
			gold: 0.42,
			pending: 0.5,
			percent: 42,
			remaining: 58,
			reached: false
		});
	});

	it('caps at full and marks reached at or past the cost', () => {
		expect(jarFill(20, 0, 20)).toMatchObject({
			gold: 1,
			percent: 100,
			remaining: 0,
			reached: true
		});
		expect(jarFill(35, 5, 20)).toMatchObject({ gold: 1, pending: 1, percent: 100, reached: true });
	});

	it('treats negative or fractional input safely', () => {
		expect(jarFill(-3, -1, 10)).toMatchObject({ gold: 0, pending: 0, percent: 0, remaining: 10 });
		expect(jarFill(2.9, 0, 10)).toMatchObject({ gold: 0.2, percent: 20 });
	});

	it('is empty for a nonsense cost', () => {
		expect(jarFill(5, 0, 0)).toEqual({
			gold: 0,
			pending: 0,
			percent: 0,
			remaining: 0,
			reached: false
		});
	});
});

describe('jarCaption', () => {
	it('reads "n of cost stars"', () => {
		expect(jarCaption(42, 100)).toBe('42 of 100 stars');
		expect(jarCaption(0, 1)).toBe('0 of 1 star');
		expect(jarCaption(-2, 5)).toBe('0 of 5 stars');
	});
});

describe('earnedDecision', () => {
	const goal = { rewardId: 'r1', cost: 20, balance: 20 };

	it('celebrates the first time the balance reaches the cost', () => {
		expect(earnedDecision(null, goal)).toEqual({ celebrate: true, store: 'r1:20' });
	});

	it('does not celebrate again for the same reaching', () => {
		expect(earnedDecision('r1:20', { ...goal, balance: 25 })).toEqual({
			celebrate: false,
			store: 'r1:20'
		});
	});

	it('forgets when below the cost or without a goal, so the next reaching celebrates', () => {
		expect(earnedDecision('r1:20', { ...goal, balance: 4 })).toEqual({
			celebrate: false,
			store: null
		});
		expect(earnedDecision('r1:20', null)).toEqual({ celebrate: false, store: null });
	});

	it('celebrates a new goal or a new cost', () => {
		expect(earnedDecision('r1:20', { ...goal, rewardId: 'r2' }).celebrate).toBe(true);
		expect(earnedDecision('r1:20', { ...goal, cost: 15 }).celebrate).toBe(true);
	});

	it('keys storage per child', () => {
		expect(earnedKey('kid-1')).toBe('hub.goal-earned.kid-1');
	});
});
