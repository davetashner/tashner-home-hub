import { describe, expect, it } from 'vitest';
import { goalEffect, rewardSize, shopCard, SMALL_REWARD_MAX, type ShopReward } from './reward-shop';

const reward = (id: string, cost: number): ShopReward => ({ id, title: id, image: null, cost });

describe('rewardSize', () => {
	it('splits at the threshold, inclusive', () => {
		expect(SMALL_REWARD_MAX).toBe(10);
		expect(rewardSize(1)).toBe('small');
		expect(rewardSize(10)).toBe('small');
		expect(rewardSize(11)).toBe('big');
		expect(rewardSize(5, 4)).toBe('big');
	});
});

describe('shopCard', () => {
	it('says how many stars are missing', () => {
		expect(shopCard(reward('a', 8), 3, null)).toEqual({
			size: 'small',
			affordable: false,
			isGoal: false,
			stillNeed: 5,
			label: '5 more stars',
			canGetNow: false,
			canMakeGoal: true
		});
		expect(shopCard(reward('a', 4), 3, null).label).toBe('1 more star');
	});
	it('lets a small affordable reward be got now', () => {
		const c = shopCard(reward('a', 8), 8, null);
		expect(c).toMatchObject({ label: 'You have enough!', canGetNow: true, stillNeed: 0 });
	});
	it('never offers Get it now for big rewards', () => {
		const c = shopCard(reward('b', 100), 500, null);
		expect(c).toMatchObject({ size: 'big', affordable: true, canGetNow: false });
	});
	it('marks the current goal and cannot re-pick it', () => {
		expect(shopCard(reward('g', 100), 0, 'g')).toMatchObject({ isGoal: true, canMakeGoal: false });
	});
	it('ignores a negative or fractional balance', () => {
		expect(shopCard(reward('a', 2), -4, null).stillNeed).toBe(2);
		expect(shopCard(reward('a', 2), 2.9, null).affordable).toBe(true);
	});
});

describe('goalEffect', () => {
	const goal = { id: 'lego', title: 'LEGO', cost: 100 };
	it('previews the goal after spending', () => {
		expect(goalEffect(42, reward('s', 5), goal)).toEqual({
			after: 37,
			from: '42/100',
			to: '37/100',
			text: 'Your LEGO goal goes from 42/100 to 37/100'
		});
	});
	it('is null with no goal or when the reward is the goal', () => {
		expect(goalEffect(42, reward('s', 5), null)).toBeNull();
		expect(goalEffect(42, reward('lego', 5), goal)).toBeNull();
	});
	it('never goes below zero', () => {
		expect(goalEffect(3, reward('s', 5), goal)?.after).toBe(0);
	});
});
