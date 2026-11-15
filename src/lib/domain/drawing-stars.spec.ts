import { describe, expect, it } from 'vitest';
import { drawingStreak, parseStarInfo, starHint } from './drawing-stars.js';

describe('drawingStreak', () => {
	it('counts consecutive days ending today', () => {
		expect(drawingStreak(['2026-11-13', '2026-11-14', '2026-11-15'], '2026-11-15')).toBe(3);
	});
	it('keeps a streak alive through yesterday', () => {
		expect(drawingStreak(['2026-11-13', '2026-11-14'], '2026-11-15')).toBe(2);
	});
	it('is 0 when the last star is older than yesterday', () => {
		expect(drawingStreak(['2026-11-12'], '2026-11-15')).toBe(0);
	});
	it('stops at a gap', () => {
		expect(drawingStreak(['2026-11-10', '2026-11-14', '2026-11-15'], '2026-11-15')).toBe(2);
	});
	it('crosses month and year ends', () => {
		expect(drawingStreak(['2026-12-31', '2027-01-01'], '2027-01-01')).toBe(2);
		expect(drawingStreak(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01')).toBe(3);
	});
	it('ignores duplicates, future days and junk', () => {
		expect(
			drawingStreak(
				['2026-11-15', '2026-11-15', '2026-11-16', 'nope', '2026-02-30', 5, null, '2026-13-01'],
				'2026-11-15'
			)
		).toBe(1);
	});
	it('is 0 for no dates or a bad today', () => {
		expect(drawingStreak([], '2026-11-15')).toBe(0);
		expect(drawingStreak(['2026-11-15'], 'today')).toBe(0);
	});
});

describe('starHint', () => {
	it('is empty without info', () => {
		expect(starHint(undefined, true)).toBe('');
	});
	it('offers the star until it is earned', () => {
		expect(starHint({ streak: 0, earned: false }, true)).toBe('+1 star');
		expect(starHint({ streak: 0, earned: false }, false)).toBe('');
		expect(starHint({ streak: 2, earned: false }, true)).toBe('2-day streak · +1 star');
		expect(starHint({ streak: 3, earned: true }, true)).toBe('3-day streak');
	});
});

describe('parseStarInfo', () => {
	it('reads good entries and drops bad ones', () => {
		expect(
			parseStarInfo({
				streaks: { a: { streak: 2, earned: true }, b: { streak: -1 }, c: null, d: { streak: 1 } }
			})
		).toEqual({ a: { streak: 2, earned: true }, d: { streak: 1, earned: false } });
	});
	it('survives malformed bodies', () => {
		expect(parseStarInfo(null)).toEqual({});
		expect(parseStarInfo({ streaks: 'x' })).toEqual({});
		expect(parseStarInfo(42)).toEqual({});
	});
});
