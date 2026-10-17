import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import {
	completeRoutineStep,
	createRoutine,
	deleteRoutine,
	listRoutines,
	updateRoutine
} from './routines.js';

let db: Db;
const steps = [
	{ label: 'Brush teeth', icon: 'toothbrush' },
	{ label: 'Get dressed', icon: 'shirt' },
	{ label: 'Shoes on', icon: 'shoes' }
];
const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members).values({ id: 'kid', name: 'Kid', role: 'child', color: 'blue' }).run();
});

describe('routines', () => {
	it('creates and lists a routine with ordered steps', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		expect(r).toEqual({
			id: expect.any(String),
			memberId: 'kid',
			name: 'Morning',
			windowStart: null,
			windowEnd: null,
			steps,
			done: 0
		});
		expect(listRoutines(db, { memberId: 'nobody' })).toEqual([]);
		expect(listRoutines(db)).toHaveLength(1);
	});

	it('rejects bad input and unknown members', () => {
		expect(code(() => createRoutine(db, { memberId: 'kid', name: '', steps }))).toBe('invalid');
		expect(code(() => createRoutine(db, { memberId: 'x', name: 'A', steps }))).toBe('not_found');
		expect(code(() => deleteRoutine(db, 'x'))).toBe('not_found');
	});

	it('tracks progress per day, never backwards, and resets on a new day', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		expect(completeRoutineStep(db, r.id, '2026-10-17', 0)).toEqual({ done: 1, total: 3 });
		expect(completeRoutineStep(db, r.id, '2026-10-17', 1)).toEqual({ done: 2, total: 3 });
		expect(completeRoutineStep(db, r.id, '2026-10-17', 0)).toEqual({ done: 2, total: 3 });
		expect(listRoutines(db, { date: '2026-10-17' })[0]!.done).toBe(2);
		expect(listRoutines(db, { date: '2026-10-18' })[0]!.done).toBe(0);
		expect(listRoutines(db)[0]!.done).toBe(0);
		expect(code(() => completeRoutineStep(db, r.id, '2026-10-17', 3))).toBe('invalid');
		expect(code(() => completeRoutineStep(db, r.id, '2026-10-17', 'a'))).toBe('invalid');
	});

	it('deletes with its steps and progress', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		completeRoutineStep(db, r.id, '2026-10-17', 2);
		expect(deleteRoutine(db, r.id)).toEqual({ deleted: true });
		expect(db.select().from(schema.routineSteps).all()).toEqual([]);
		expect(db.select().from(schema.routineProgress).all()).toEqual([]);
	});
});

describe('updateRoutine', () => {
	it('renames and moves the window, keeping progress when the steps are unchanged', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		completeRoutineStep(db, r.id, '2026-01-05', 1);
		const u = updateRoutine(db, r.id, {
			name: 'AM',
			windowStart: '07:00',
			windowEnd: '09:00',
			steps
		});
		expect(u).toMatchObject({ name: 'AM', windowStart: '07:00', windowEnd: '09:00', steps });
		expect(listRoutines(db, { date: '2026-01-05' })[0].done).toBe(2);
	});

	it('replaces and reorders steps and clears progress', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		completeRoutineStep(db, r.id, '2026-01-05', 2);
		const next = [steps[2], steps[0]];
		const u = updateRoutine(db, r.id, { name: 'Morning', steps: next });
		expect(u.steps).toEqual(next);
		expect(listRoutines(db, { date: '2026-01-05' })[0].done).toBe(0);
	});

	it('moves to another member', () => {
		db.insert(schema.members).values({ id: 'k2', name: 'K2', role: 'child', color: 'red' }).run();
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		expect(updateRoutine(db, r.id, { memberId: 'k2', name: 'Morning', steps }).memberId).toBe('k2');
	});

	it('rejects bad input, unknown routines and unknown members', () => {
		const r = createRoutine(db, { memberId: 'kid', name: 'Morning', steps });
		expect(code(() => updateRoutine(db, r.id, { name: '', steps }))).toBe('invalid');
		expect(code(() => updateRoutine(db, 'nope', { name: 'x', steps }))).toBe('not_found');
		expect(code(() => updateRoutine(db, r.id, { memberId: 'zz', name: 'x', steps }))).toBe(
			'not_found'
		);
		expect(listRoutines(db)[0].name).toBe('Morning');
	});
});
