import { describe, expect, it } from 'vitest';
import {
	flexNote,
	isDoable,
	jarSlots,
	localDate,
	setStatus,
	kidsToShow,
	kidsWithChores,
	switcherMembers,
	undoSecondsLeft,
	starJobGroups,
	habitChores,
	isHabit,
	doneCount,
	habitCount,
	type KidChore,
	type KidGroup
} from './kid-chores.js';
import type { KidRoutine } from './routines.js';

const findChore = (g: KidGroup[], id: string) =>
	g.flatMap((x) => x.chores).find((c) => c.id === id);

const groups = (): KidGroup[] => [
	{
		timeOfDay: 'morning',
		chores: [{ id: 'a', title: 'Teeth', icon: '🪥', stars: 1, status: 'none', completionId: null }]
	}
];

describe('kid chores view logic', () => {
	it('formats the local day in a zone', () => {
		const t = Date.UTC(2026, 9, 15, 3, 0, 0);
		expect(localDate(t, 'America/Chicago')).toBe('2026-10-14');
		expect(localDate(t, 'UTC')).toBe('2026-10-15');
	});

	it('knows which states are doable', () => {
		expect(
			['none', 'rejected', 'undone', 'pending', 'approved'].map((s) => isDoable(s as never))
		).toEqual([true, true, true, false, false]);
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
	});

	it('lays out jar slots: gold, then outlined pending, capped', () => {
		expect(jarSlots(3, 2, 20)).toEqual({ total: 20, gold: 3, pending: 2 });
		expect(jarSlots(40, 5, 100)).toEqual({ total: 24, gold: 24, pending: 0 });
	});

	it('shows only members with chores, or everyone when none have any', () => {
		const members = [{ id: 'm1' }, { id: 'm2' }];
		expect(switcherMembers(members, { m1: groups(), m2: [] })).toEqual([{ id: 'm1' }]);
		expect(switcherMembers(members, { m1: [], m2: [] })).toEqual(members);
	});

	it('lists only the kids with chores today, so the switcher hides for fewer than two', () => {
		const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
		expect(kidsWithChores(members, { m1: groups(), m2: [], m3: groups() })).toEqual([
			{ id: 'm1' },
			{ id: 'm3' }
		]);
		expect(kidsWithChores(members, { m2: [] })).toEqual([]);
	});

	describe('kidsToShow', () => {
		const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
		const routine = (start: string | null, end: string | null) => [
			{
				id: 'r',
				name: 'Morning',
				windowStart: start,
				windowEnd: end,
				steps: [{ label: 'Teeth', icon: 'toothbrush' as const }],
				done: 0
			}
		];
		const boards = { a: groups(), c: groups() };
		const routinesBy = {
			b: routine(null, null), // routine only
			c: routine(null, null), // both
			e: routine('06:00', '09:00') // outside its window at noon
		};

		it('keeps chores-only, routine-only and both; drops neither and out-of-window', () => {
			expect(kidsToShow(members, boards, routinesBy, 12 * 60).map((m) => m.id)).toEqual([
				'a',
				'b',
				'c'
			]);
		});

		it('includes the windowed routine kid once its window opens', () => {
			expect(kidsToShow(members, boards, routinesBy, 7 * 60).map((m) => m.id)).toContain('e');
		});

		it('switcherMembers falls back to everyone when nobody qualifies', () => {
			expect(switcherMembers(members, {}, {}, 0)).toEqual(members);
		});
	});
});

describe('Star Jobs and habits (hub-esf)', () => {
	const c = (id: string, kind: 'star_job' | 'habit' | undefined, status: KidChore['status']) =>
		({
			id,
			title: id,
			icon: null,
			stars: kind === 'habit' ? 0 : 1,
			status,
			completionId: null,
			kind
		}) as KidChore;
	const board: KidGroup[] = [
		{
			timeOfDay: 'morning',
			chores: [c('towels', 'habit', 'approved'), c('window', undefined, 'none')]
		},
		{ timeOfDay: 'evening', chores: [c('fish', 'habit', 'none')] },
		{ timeOfDay: 'anytime', chores: [c('bedroom', 'star_job', 'pending')] }
	];
	const routine = (done: number, steps = 2) =>
		({
			id: `r${done}${steps}`,
			name: 'Morning',
			windowStart: null,
			windowEnd: null,
			steps: Array.from({ length: steps }, () => ({ label: 'x', icon: 'star' as const })),
			done
		}) as KidRoutine;

	it('splits a board into Star Jobs (keeping groups) and habits', () => {
		expect(starJobGroups(board).map((g) => [g.timeOfDay, g.chores.map((x) => x.id)])).toEqual([
			['morning', ['window']],
			['anytime', ['bedroom']]
		]);
		expect(habitChores(board).map((x) => x.id)).toEqual(['towels', 'fish']);
		expect(isHabit(c('x', 'habit', 'none'))).toBe(true);
	});

	it('counts checked-off items, waiting ones included', () => {
		expect(doneCount(starJobGroups(board).flatMap((g) => g.chores))).toEqual({ done: 1, total: 2 });
		expect(doneCount([])).toEqual({ done: 0, total: 0 });
	});

	it('counts each routine as one habit, done when finished, and ignores empty routines', () => {
		const habits = habitChores(board);
		expect(habitCount(habits, [routine(2), routine(1), routine(0, 0)])).toEqual({
			done: 2,
			total: 4
		});
		expect(habitCount([], [])).toEqual({ done: 0, total: 0 });
	});
});

describe('flexNote', () => {
	it('names the day the period ends', () => {
		expect(flexNote({ dueBy: '2026-03-08', week: 1, weeks: 1 })).toBe('Due by Sunday');
		expect(flexNote({ dueBy: '2026-03-15', week: 1, weeks: 2 })).toBe(
			'Week 1 of 2 · due by next Sunday'
		);
		expect(flexNote({ dueBy: '2026-03-15', week: 2, weeks: 2 })).toBe(
			'Week 2 of 2 · due by Sunday'
		);
	});
});
