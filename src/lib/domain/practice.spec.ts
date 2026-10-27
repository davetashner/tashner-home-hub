import { describe, expect, it } from 'vitest';
import { minutesToNextStar, starsForLog, starsForMinutes, type PracticeRate } from './practice.js';

const rate: PracticeRate = { minutesPerBlock: 15, starsPerBlock: 1, dailyStarCap: 4 };

describe('starsForMinutes', () => {
	it('earns a star per full block', () => {
		expect(starsForMinutes(rate, 0)).toBe(0);
		expect(starsForMinutes(rate, 14)).toBe(0);
		expect(starsForMinutes(rate, 15)).toBe(1);
		expect(starsForMinutes(rate, 44)).toBe(2);
	});
	it('multiplies by stars per block', () => {
		expect(starsForMinutes({ ...rate, starsPerBlock: 3, dailyStarCap: 10 }, 30)).toBe(6);
	});
	it('stops at the daily cap', () => {
		expect(starsForMinutes(rate, 60)).toBe(4);
		expect(starsForMinutes(rate, 1_000_000)).toBe(4);
		expect(starsForMinutes({ ...rate, starsPerBlock: 3, dailyStarCap: 5 }, 30)).toBe(5);
	});
	it('treats negative, fractional and non-finite input safely', () => {
		expect(starsForMinutes(rate, -50)).toBe(0);
		expect(starsForMinutes(rate, Number.NaN)).toBe(0);
		expect(starsForMinutes(rate, Infinity)).toBe(0);
		expect(starsForMinutes(rate, 15.9)).toBe(1);
		expect(starsForMinutes({ ...rate, minutesPerBlock: 0 }, 100)).toBe(0);
		expect(starsForMinutes({ ...rate, dailyStarCap: -1 }, 100)).toBe(0);
	});
});

describe('starsForLog', () => {
	it('carries leftover minutes within the day', () => {
		expect(starsForLog(rate, 0, 10)).toBe(0);
		expect(starsForLog(rate, 10, 5)).toBe(1);
		expect(starsForLog(rate, 15, 14)).toBe(0);
	});
	it('splitting a session never changes the total', () => {
		let minutes = 0;
		let stars = 0;
		for (const m of [7, 7, 7, 7, 7, 7, 7, 7, 7]) {
			stars += starsForLog(rate, minutes, m);
			minutes += m;
		}
		expect(stars).toBe(starsForMinutes(rate, 63));
	});
	it('earns only up to the cap', () => {
		expect(starsForLog(rate, 45, 60)).toBe(1);
		expect(starsForLog(rate, 60, 30)).toBe(0);
		expect(starsForLog(rate, 0, 1_000_000)).toBe(4);
	});
	it('ignores zero, negative and bad minutes', () => {
		expect(starsForLog(rate, 10, 0)).toBe(0);
		expect(starsForLog(rate, 10, -30)).toBe(0);
		expect(starsForLog(rate, 10, Number.NaN)).toBe(0);
		expect(starsForLog(rate, -10, 15)).toBe(1);
	});
});

describe('minutesToNextStar', () => {
	it('counts down inside a block', () => {
		expect(minutesToNextStar(rate, 0)).toBe(15);
		expect(minutesToNextStar(rate, 10)).toBe(5);
		expect(minutesToNextStar(rate, 15)).toBe(15);
	});
	it('is null at the cap or with a bad rate', () => {
		expect(minutesToNextStar(rate, 60)).toBeNull();
		expect(minutesToNextStar({ ...rate, minutesPerBlock: 0 }, 5)).toBeNull();
	});
});
