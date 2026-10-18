import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, schema, type Db } from '../db/index.js';
import {
	APPROVAL_SETTING_KEY,
	approvalDefault,
	setApprovalDefault,
	turnOffAllApprovals
} from './approval-setting.js';
import { balances, completeChore, createChore } from './ledger.js';

let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values([{ id: 'kid', name: 'Test Kid', role: 'child', color: 'member-1' }])
		.run();
});

describe('approvalDefault', () => {
	it('is off when never set', () => {
		expect(approvalDefault(db)).toBe(false);
	});

	it('reads back what was set', () => {
		expect(setApprovalDefault(db, true)).toBe(true);
		expect(approvalDefault(db)).toBe(true);
		setApprovalDefault(db, false);
		expect(approvalDefault(db)).toBe(false);
	});

	it('treats a corrupt value as off', () => {
		db.insert(schema.settings).values({ key: APPROVAL_SETTING_KEY, value: '{oops' }).run();
		expect(approvalDefault(db)).toBe(false);
	});
});

describe('turnOffAllApprovals', () => {
	it('turns approval off everywhere and approves what was waiting', () => {
		setApprovalDefault(db, true);
		const checked = createChore(db, { title: 'Dishes', stars: 2, memberIds: ['kid'] });
		createChore(db, { title: 'Feed fish', memberIds: ['kid'], requiresApproval: false });
		const { completion } = completeChore(db, {
			choreId: checked.id,
			memberId: 'kid',
			date: '2026-01-05',
			now: Date.UTC(2026, 0, 5, 18)
		});
		expect(completion.status).toBe('pending');
		expect(balances(db).kid).toBe(0);

		expect(turnOffAllApprovals(db)).toEqual({ chores: 1, approved: 1 });

		expect(approvalDefault(db)).toBe(false);
		const still = db.select().from(schema.chores).where(eq(schema.chores.requiresApproval, true));
		expect(still.all()).toEqual([]);
		const after = db
			.select()
			.from(schema.choreCompletions)
			.where(eq(schema.choreCompletions.id, completion.id))
			.get();
		expect(after?.status).toBe('approved');
		expect(balances(db).kid).toBe(2);
	});

	it('is a no-op the second time', () => {
		expect(turnOffAllApprovals(db)).toEqual({ chores: 0, approved: 0 });
	});
});
