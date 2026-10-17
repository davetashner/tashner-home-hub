import { describe, expect, it } from 'vitest';
import {
	actionLabel,
	activityRows,
	activityTitle,
	newBonuses,
	newestAt,
	planAdjustment,
	type LedgerRow
} from './bonus.js';

const row = (o: Partial<LedgerRow> & { id: string }): LedgerRow => ({
	delta: 1,
	reason: 'bonus',
	note: null,
	status: 'approved',
	createdAt: 1,
	...o
});

describe('planAdjustment', () => {
	it('gives with a default note', () => {
		expect(planAdjustment({ delta: 2, balance: 0 })).toEqual({
			ok: true,
			delta: 2,
			note: 'Bonus stars',
			clamped: false
		});
		expect(planAdjustment({ delta: 1, note: '  Kindness ', balance: 0 })).toMatchObject({
			note: 'Kindness'
		});
	});

	it('requires a note to remove', () => {
		expect(planAdjustment({ delta: -1, note: '  ', balance: 5 })).toMatchObject({ ok: false });
		expect(planAdjustment({ delta: -1, balance: 5 })).toMatchObject({ ok: false });
	});

	it('removes and clamps to the balance', () => {
		expect(planAdjustment({ delta: -2, note: 'x', balance: 5 })).toEqual({
			ok: true,
			delta: -2,
			note: 'x',
			clamped: false
		});
		expect(planAdjustment({ delta: -5, note: 'x', balance: 3 })).toMatchObject({
			delta: -3,
			clamped: true
		});
		expect(planAdjustment({ delta: -1, note: 'x', balance: 0 })).toMatchObject({ ok: false });
		expect(planAdjustment({ delta: -1, note: 'x', balance: -4 })).toMatchObject({ ok: false });
	});

	it('rejects bad amounts and long notes', () => {
		for (const delta of [0, 1.5, 'a', null, 51, -51])
			expect(planAdjustment({ delta, note: 'x', balance: 99 })).toMatchObject({ ok: false });
		expect(planAdjustment({ delta: 1, note: 'x'.repeat(201), balance: 0 })).toMatchObject({
			ok: false
		});
	});
});

describe('labels and activity', () => {
	it('labels the button and titles rows', () => {
		expect([actionLabel(0), actionLabel(2), actionLabel(-1)]).toEqual([
			'Pick an amount',
			'Give 2 ⭐',
			'Remove 1 ⭐'
		]);
		expect(activityTitle(row({ id: 'a', note: 'Kindness' }))).toBe('Kindness');
		expect(activityTitle(row({ id: 'a' }))).toBe('Bonus stars');
		expect(activityTitle(row({ id: 'a', delta: -1, reason: 'adjustment' }))).toBe('Stars removed');
		expect(activityTitle(row({ id: 'a', reason: 'streak' }))).toBe('Streak bonus');
	});

	it('lists activity newest first and finds unseen bonuses', () => {
		const rows = [
			row({ id: 'a', createdAt: 1 }),
			row({ id: 'b', reason: 'chore', createdAt: 2 }),
			row({ id: 'c', reason: 'streak', createdAt: 3 }),
			row({ id: 'd', reason: 'adjustment', delta: -1, createdAt: 4, status: 'rejected' }),
			row({ id: 'e', reason: 'adjustment', delta: -1, createdAt: 5 })
		];
		expect(activityRows(rows).map((r) => r.id)).toEqual(['e', 'c', 'a']);
		expect(activityRows(rows, 1)).toHaveLength(1);
		expect(newBonuses(rows, null)).toEqual([]);
		expect(newBonuses(rows, 0).map((r) => r.id)).toEqual(['a']);
		expect(newBonuses(rows, 1)).toEqual([]);
		expect(newestAt(rows)).toBe(5);
		expect(newestAt([])).toBe(0);
	});
});
