import { describe, expect, it } from 'vitest';
import {
	isDoable,
	jarSlots,
	localDate,
	setStatus,
	switcherMembers,
	undoSecondsLeft,
	type KidGroup
} from './kid-chores.js';

const findChore = (g: KidGroup[], id: string) =>
	g.flatMap((x) => x.chores).find((c) => c.id === id);

const groups = (): KidGroup[] => [
	{
		timeOfDay: 'morning',
		chores: [
			{ id: 'a', title: 'Teeth', icon: '🪥', stars: 1, status: 'none', completionId: null },
			{ id: 'b', title: 'Bed', icon: '🛏️', stars: 2, status: 'approved', completionId: 'x' }
		]
	}
];

describe('kid chores view logic', () => {
	it('formats the local day in a zone', () => {
		const t = Date.UTC(2026, 9, 15, 3, 0, 0);
		expect(localDate(t, 'America/Chicago')).toBe('2026-10-14');
		expect(localDate(t, 'UTC')).toBe('2026-10-15');
	});

	it('knows which states are doable', () => {
		expect(['none', 'rejected', 'undone'].every((s) => isDoable(s as never))).toBe(true);
		expect(isDoable('pending')).toBe(false);
		expect(isDoable('approved')).toBe(false);
	});

	it('sets status and completion id without mutating the input', () => {
		const g = groups();
		const next = setStatus(g, 'a', 'pending', 'c1');
		expect(findChore(g, 'a')?.status).toBe('none');
		expect(findChore(next, 'a')).toMatchObject({ status: 'pending', completionId: 'c1' });
		expect(findChore(next, 'zzz')).toBeUndefined();
	});

	it('counts down the undo window', () => {
		expect(undoSecondsLeft(0, 0)).toBe(10);
		expect(undoSecondsLeft(0, 9_100)).toBe(1);
		expect(undoSecondsLeft(0, 10_000)).toBe(0);
		expect(undoSecondsLeft(0, 99_000)).toBe(0);
	});

	it('lays out jar slots: gold, then outlined pending, capped', () => {
		expect(jarSlots(3, 2, 20)).toEqual({ total: 20, gold: 3, pending: 2 });
		expect(jarSlots(12, 1, null)).toEqual({ total: 15, gold: 12, pending: 1 });
		expect(jarSlots(40, 5, 100)).toEqual({ total: 24, gold: 24, pending: 0 });
		expect(jarSlots(9, 5, 10)).toEqual({ total: 10, gold: 9, pending: 1 });
	});

	it('shows only members with chores, or everyone when none have any', () => {
		const members = [{ id: 'm1' }, { id: 'm2' }];
		expect(switcherMembers(members, { m1: groups(), m2: [] })).toEqual([{ id: 'm1' }]);
		expect(switcherMembers(members, { m1: [], m2: [] })).toEqual(members);
	});
});
