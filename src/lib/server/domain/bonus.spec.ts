import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { adjustStars } from './bonus.js';
import { history } from './ledger.js';
import { starBalance } from './stars.js';

let db: Db;
const kid = 'kid-1';

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code?: string }).code;
	}
};

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values({ id: kid, name: 'Test kid', role: 'child', color: 'blue' })
		.run();
});

describe('adjustStars', () => {
	it('writes a bonus row with a default note', () => {
		const r = adjustStars(db, { memberId: kid, delta: 2 });
		expect(r.transaction).toMatchObject({ reason: 'bonus', delta: 2, note: 'Bonus stars' });
		expect(r.balance).toBe(2);
		expect(r.clamped).toBe(false);
	});

	it('writes an adjustment row for a removal and requires a note', () => {
		adjustStars(db, { memberId: kid, delta: 5, note: 'Kindness' });
		expect(code(() => adjustStars(db, { memberId: kid, delta: -1 }))).toBe('invalid');
		const r = adjustStars(db, { memberId: kid, delta: -2, note: 'Hit sibling' });
		expect(r.transaction).toMatchObject({ reason: 'adjustment', delta: -2 });
		expect(r.balance).toBe(3);
		expect(starBalance(db, kid)).toBe(3);
		expect(history(db, kid)).toHaveLength(2);
	});

	it('clamps a removal to the balance and refuses when empty', () => {
		adjustStars(db, { memberId: kid, delta: 2 });
		const r = adjustStars(db, { memberId: kid, delta: -5, note: 'x' });
		expect(r).toMatchObject({ balance: 0, clamped: true });
		expect(r.transaction.delta).toBe(-2);
		expect(code(() => adjustStars(db, { memberId: kid, delta: -1, note: 'x' }))).toBe('invalid');
	});

	it('rejects unknown members and bad deltas', () => {
		expect(code(() => adjustStars(db, { memberId: 'ghost', delta: -1, note: 'x' }))).toBe(
			'not_found'
		);
		expect(code(() => adjustStars(db, { memberId: kid, delta: 'a' }))).toBe('invalid');
	});
});
