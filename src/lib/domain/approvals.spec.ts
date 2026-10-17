import { describe, expect, it } from 'vitest';
import {
	attentionLabel,
	badgeLabel,
	compactCount,
	groupByChild,
	relativeTime,
	type PendingItem
} from './approvals';

const item = (id: string, memberId: string, stars: number): PendingItem => ({
	completionId: id,
	memberId,
	memberName: memberId.toUpperCase(),
	choreTitle: 'Chore',
	choreIcon: null,
	stars,
	completedAt: 0
});

describe('groupByChild', () => {
	it('groups in first-seen order and sums stars', () => {
		const groups = groupByChild([item('1', 'a', 2), item('2', 'b', 1), item('3', 'a', 3)]);
		expect(groups.map((g) => g.memberId)).toEqual(['a', 'b']);
		expect(groups[0].items.map((i) => i.completionId)).toEqual(['1', '3']);
		expect(groups[0].stars).toBe(5);
	});
	it('returns nothing for nothing', () => {
		expect(groupByChild([])).toEqual([]);
	});
});

describe('relativeTime', () => {
	const now = 1_000_000_000_000;
	it.each([
		[0, 'just now'],
		[-5_000, 'just now'], // clock skew never goes negative
		[59_000, 'just now'],
		[10 * 60_000, '10 min ago'],
		[3 * 3_600_000, '3 hr ago'],
		[25 * 3_600_000, 'yesterday'],
		[5 * 86_400_000, '5 days ago']
	])('%i ms ago', (age, text) => {
		expect(relativeTime(now - age, now)).toBe(text);
	});
});

describe('badgeLabel', () => {
	it('is empty at zero', () => {
		expect(badgeLabel(0)).toBe('');
		expect(badgeLabel(2)).toBe('2 ⭐ to check');
	});
});

describe('compactCount', () => {
	it('is empty at zero and caps the count at 99+', () => {
		expect(compactCount(0)).toBe('');
		expect(compactCount(7)).toBe('7');
		expect(compactCount(99)).toBe('99');
		expect(compactCount(100)).toBe('99+');
		expect(compactCount(218)).toBe('99+');
	});
});

describe('attentionLabel', () => {
	it('describes both kinds of work, singular and plural', () => {
		expect(attentionLabel(0)).toBe('');
		expect(attentionLabel(1)).toBe('1 thing needs a grown-up');
		expect(attentionLabel(3)).toBe('3 things need a grown-up');
	});
});
