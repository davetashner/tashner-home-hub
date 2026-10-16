import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import { approveCompletion, awardBonus, completeChore, createChore } from './ledger.js';
import { redeemReward } from './redemptions.js';
import { archiveReward, createReward, setGoal } from './rewards.js';
import { attentionCount } from './attention.js';

let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([
			{ id: 'kid', name: 'Kid A', role: 'child', color: 'member-1' },
			{ id: 'sib', name: 'Kid B', role: 'child', color: 'member-2' },
			{ id: 'grown', name: 'Grown Up', role: 'adult', color: 'member-3' }
		])
		.run();
});

describe('attentionCount', () => {
	it('is zero for an empty household', () => {
		expect(attentionCount(db)).toEqual({ pending: 0, ready: 0, total: 0 });
	});

	it('counts pending approvals only', () => {
		const c = createChore(db, { title: 'A', memberIds: ['kid'] });
		completeChore(db, { choreId: c.id, memberId: 'kid', date: '2026-01-05', now: 1 });
		expect(attentionCount(db)).toEqual({ pending: 1, ready: 0, total: 1 });
	});

	it('counts reached goals only', () => {
		const r = createReward(db, { title: 'Park', cost: 5 });
		setGoal(db, 'kid', r.id);
		awardBonus(db, { memberId: 'kid', delta: 8, note: 'seed' });
		expect(attentionCount(db)).toEqual({ pending: 0, ready: 1, total: 1 });
	});

	it('adds both together', () => {
		const r = createReward(db, { title: 'Park', cost: 5 });
		setGoal(db, 'kid', r.id);
		awardBonus(db, { memberId: 'kid', delta: 5, note: 'seed' });
		const c = createChore(db, { title: 'A', memberIds: ['sib'] });
		completeChore(db, { choreId: c.id, memberId: 'sib', date: '2026-01-05', now: 1 });
		expect(attentionCount(db)).toEqual({ pending: 1, ready: 1, total: 2 });
	});

	it('counts a kid exactly at cost but not one a star short', () => {
		const r = createReward(db, { title: 'Park', cost: 5 });
		setGoal(db, 'kid', r.id);
		setGoal(db, 'sib', r.id);
		awardBonus(db, { memberId: 'kid', delta: 5, note: 'seed' });
		awardBonus(db, { memberId: 'sib', delta: 4, note: 'seed' });
		expect(attentionCount(db).ready).toBe(1);
	});

	it('ignores a kid with no goal and an archived goal reward', () => {
		awardBonus(db, { memberId: 'kid', delta: 50, note: 'seed' });
		expect(attentionCount(db).ready).toBe(0);
		const r = createReward(db, { title: 'Old', cost: 5 });
		setGoal(db, 'kid', r.id);
		expect(attentionCount(db).ready).toBe(1);
		archiveReward(db, r.id);
		expect(attentionCount(db).ready).toBe(0);
	});

	it('only counts approved stars, then drops when approval lands and redemption clears', () => {
		const r = createReward(db, { title: 'Park', cost: 5 });
		setGoal(db, 'kid', r.id);
		awardBonus(db, { memberId: 'kid', delta: 3, note: 'seed' });
		const c = createChore(db, { title: 'A', memberIds: ['kid'], stars: 2 });
		const done = completeChore(db, { choreId: c.id, memberId: 'kid', date: '2026-01-05', now: 1 });
		expect(attentionCount(db)).toEqual({ pending: 1, ready: 0, total: 1 });
		approveCompletion(db, done.completion.id);
		expect(attentionCount(db)).toEqual({ pending: 0, ready: 1, total: 1 });
		redeemReward(db, { memberId: 'kid', rewardId: r.id, approvedBy: 'grown' });
		expect(attentionCount(db)).toEqual({ pending: 0, ready: 0, total: 0 });
	});
});
