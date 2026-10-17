import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { createCountdown, deleteCountdown, listCountdowns, updateCountdown } from './countdowns.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('countdown storage', () => {
	it('creates with a trimmed title and optional emoji', () => {
		const c = createCountdown(db, { title: '  Beach trip ', targetDate: '2026-12-01', icon: '🏖️' });
		expect(c).toMatchObject({ title: 'Beach trip', targetDate: '2026-12-01', icon: '🏖️' });
		expect(createCountdown(db, { title: 'x', targetDate: '2026-12-02', icon: '' }).icon).toBeNull();
	});
	it('rejects bad input', () => {
		expect(code(() => createCountdown(db, { title: ' ', targetDate: '2026-12-01' }))).toBe(
			'invalid'
		);
		expect(
			code(() => createCountdown(db, { title: 'a'.repeat(61), targetDate: '2026-12-01' }))
		).toBe('invalid');
		expect(code(() => createCountdown(db, { title: 'a', targetDate: '2026-02-30' }))).toBe(
			'invalid'
		);
		expect(
			code(() => createCountdown(db, { title: 'a', targetDate: '2026-12-01', icon: 'ab' }))
		).toBe('invalid');
	});
	it('lists soonest first, edits and deletes', () => {
		const a = createCountdown(db, { title: 'Later', targetDate: '2027-01-01' });
		createCountdown(db, { title: 'Sooner', targetDate: '2026-11-01' });
		expect(listCountdowns(db).map((c) => c.title)).toEqual(['Sooner', 'Later']);
		expect(updateCountdown(db, a.id, { targetDate: '2026-10-20' }).targetDate).toBe('2026-10-20');
		expect(updateCountdown(db, a.id, {})).toMatchObject({ title: 'Later' });
		expect(code(() => updateCountdown(db, 'nope', { title: 'x' }))).toBe('not_found');
		expect(deleteCountdown(db, a.id)).toEqual({ id: a.id });
		expect(code(() => deleteCountdown(db, a.id))).toBe('not_found');
		expect(listCountdowns(db)).toHaveLength(1);
	});
});
