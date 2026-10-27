import { describe, expect, it } from 'vitest';
import {
	flexNote,
	isDoable,
	jarSlots,
	localDate,
	setStatus,
	kidsToShow,
	kidsWithChores,
	defaultKid,
	undoSecondsLeft,
	starJobGroups,
	habitChores,
	isHabit,
	doneCount,
	habitCount,
	columnAt,
	routineColumn,
	timeColumns,
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

		it('shows every child, with or without chores or a routine', () => {
			expect(kidsToShow(members).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
		});

		it('selects the wanted kid, even one with nothing today', () => {
			expect(defaultKid(members, boards, routinesBy, 12 * 60, 'd')?.id).toBe('d');
		});

		it('defaults to the first kid with chores or an open routine', () => {
			expect(defaultKid(members, { c: groups() }, {}, 0)?.id).toBe('c');
			expect(defaultKid(members, boards, routinesBy, 12 * 60, 'zzz')?.id).toBe('a');
			expect(defaultKid(members, {}, { e: routine('06:00', '09:00') }, 7 * 60)?.id).toBe('e');
		});

		it('falls back to the first kid when nobody has anything, and null when no kids', () => {
			expect(defaultKid(members, {}, { e: routine('06:00', '09:00') }, 12 * 60)?.id).toBe('a');
			expect(defaultKid([], {}, {}, 0)).toBeNull();
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

describe('time columns (hub-3yg)', () => {
	const chore = (id: string, kind?: 'habit') =>
		({ id, title: id, icon: null, stars: 1, status: 'none', completionId: null, kind }) as KidChore;
	const routine = (windowStart: string | null): KidRoutine => ({
		id: 'r',
		name: 'Routine',
		windowStart,
		windowEnd: windowStart && '23:00',
		steps: [{ label: 'x', icon: 'star' }],
		done: 0
	});

	it('splits the day into morning, after school and tonight', () => {
		expect(columnAt(0)).toBe('morning');
		expect(columnAt(11 * 60 + 59)).toBe('morning');
		expect(columnAt(12 * 60)).toBe('afternoon');
		expect(columnAt(16 * 60 + 59)).toBe('afternoon');
		expect(columnAt(17 * 60)).toBe('evening');
		expect(columnAt(23 * 60 + 59)).toBe('evening');
	});

	it('puts a routine where its window opens, or where the clock is', () => {
		expect(routineColumn(routine('07:00'), 20 * 60)).toBe('morning');
		expect(routineColumn(routine('18:30'), 8 * 60)).toBe('evening');
		expect(routineColumn(routine(null), 13 * 60)).toBe('afternoon');
	});

	it('shares one list per column and sends anytime and any-day to-dos to Now', () => {
		const board: KidGroup[] = [
			{ timeOfDay: 'morning', chores: [chore('job'), chore('habit', 'habit')] },
			{ timeOfDay: 'evening', chores: [chore('late')] },
			{ timeOfDay: 'anytime', chores: [chore('free')] },
			{ timeOfDay: 'week', chores: [chore('room')] }
		];
		const cols = timeColumns(board, [routine('07:00')], 13 * 60);
		expect(cols.map((c) => [c.key, c.label, c.now])).toEqual([
			['morning', 'Morning', false],
			['afternoon', 'After school', true],
			['evening', 'Tonight', false]
		]);
		expect(cols[0].chores.map((c) => c.id)).toEqual(['job', 'habit']);
		expect(cols[0].routines).toHaveLength(1);
		expect(cols[1].chores.map((c) => c.id)).toEqual(['free']);
		expect(cols[1].weekly.map((c) => c.id)).toEqual(['room']);
		expect(cols[2].chores.map((c) => c.id)).toEqual(['late']);
		expect(cols[2].weekly).toEqual([]);
	});
});
