import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { completeRoutineStep, createRoutine, deleteRoutine, listRoutines } from './routines.js';

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
