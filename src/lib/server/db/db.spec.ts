import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { eq, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { dbPath, getDb, openDb, schema, type Db } from './index.js';
import { starBalance } from '../domain/stars.js';

const {
	members,
	calendarSources,
	events,
	photoSources,
	photos,
	chores,
	choreCompletions,
	starTransactions,
	rewards,
	goals,
	redemptions,
	lists,
	listItems,
	mealPlanEntries,
	countdowns,
	settings
} = schema;

function seedMember(db: Db, id = 'm1', role: 'adult' | 'child' = 'child') {
	db.insert(members)
		.values({ id, name: `Member ${id}`, role, color: 'blue' })
		.run();
}

function tx(
	db: Db,
	id: string,
	memberId: string,
	delta: number,
	reason: (typeof schema.STAR_REASONS)[number],
	status: 'pending' | 'approved' | 'rejected' = 'approved'
) {
	db.insert(starTransactions).values({ id, memberId, delta, reason, status }).run();
}

describe('migrations', () => {
	it('migrates a fresh database and creates every table', () => {
		const db = openDb(':memory:');
		const names = db.$client
			.prepare("select name from sqlite_master where type = 'table'")
			.all()
			.map((r) => (r as { name: string }).name);
		for (const t of [
			'members',
			'calendar_sources',
			'events',
			'photo_sources',
			'photos',
			'chores',
			'chore_completions',
			'star_transactions',
			'rewards',
			'goals',
			'redemptions',
			'lists',
			'list_items',
			'meal_plan_entries',
			'countdowns',
			'settings'
		]) {
			expect(names).toContain(t);
		}
	});

	it('is idempotent when run twice on the same file, with WAL and foreign keys on', () => {
		const dir = mkdtempSync(join(tmpdir(), 'hub-db-'));
		try {
			const file = join(dir, 'hub.db');
			openDb(file).$client.close();
			const db = openDb(file);
			expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
			expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
			db.$client.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('write transactions', () => {
	/** Reads in `db`'s transaction, lets another connection commit, then writes. */
	function readOtherCommitsWrite(file: string, behavior?: 'deferred') {
		const db = openDb(file);
		const other = new Database(file, { timeout: 0 });
		let otherError: string | undefined;
		try {
			db.transaction((tx) => {
				tx.select().from(members).all();
				try {
					other
						.prepare(
							"INSERT INTO members (id, name, role, color) VALUES ('o', 'O', 'child', 'blue')"
						)
						.run();
				} catch (e) {
					otherError = (e as { code?: string }).code;
				}
				seedMember(tx as unknown as Db, 'm-tx');
			}, behavior && { behavior });
			return { otherError };
		} finally {
			other.close();
			db.$client.close();
		}
	}

	it('take the write lock up front, so a concurrent commit cannot fail them', () => {
		const dir = mkdtempSync(join(tmpdir(), 'hub-db-'));
		try {
			// The other writer waits (here: fails fast) instead of breaking this transaction.
			expect(readOtherCommitsWrite(join(dir, 'hub.db')).otherError).toBe('SQLITE_BUSY');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('would fail with a stale snapshot when deferred (why immediate is the default)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'hub-db-'));
		try {
			expect(() => readOtherCommitsWrite(join(dir, 'hub.db'), 'deferred')).toThrow(
				/database is locked|SQLITE_BUSY/
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('getDb', () => {
	const original = process.env.DATA_DIR;
	afterEach(() => {
		if (original === undefined) delete process.env.DATA_DIR;
		else process.env.DATA_DIR = original;
	});

	it('opens hub.db under DATA_DIR and caches the instance', () => {
		const dir = mkdtempSync(join(tmpdir(), 'hub-data-'));
		process.env.DATA_DIR = join(dir, 'nested');
		try {
			const db = getDb();
			expect(getDb()).toBe(db);
			expect(dbPath(process.env.DATA_DIR)).toBe(join(dir, 'nested', 'hub.db'));
			expect(db.select().from(members).all()).toEqual([]);
			db.$client.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('defaults the data directory to ./data', () => {
		delete process.env.DATA_DIR;
		expect(dbPath()).toBe(join('./data', 'hub.db'));
	});
});

describe('schema definition', () => {
	it('declares foreign keys that resolve to real tables', () => {
		const tables = (Object.values(schema) as unknown[]).filter((v) =>
			is(v, SQLiteTable)
		) as SQLiteTable[];
		expect(tables).toHaveLength(19);
		const fks = tables.flatMap((t) => getTableConfig(t).foreignKeys);
		expect(fks.length).toBeGreaterThan(10);
		for (const fk of fks) {
			expect(fk.reference().foreignTable).toBeDefined();
		}
	});
});

describe('schema round trips', () => {
	it('stores and reads across the main tables', () => {
		const db = openDb(':memory:');
		seedMember(db, 'kid', 'child');
		seedMember(db, 'mom', 'adult');
		db.insert(calendarSources)
			.values({ id: 'cs1', provider: 'ics', label: 'Family', credentials: 'enc:opaque' })
			.run();
		db.insert(events)
			.values({
				id: 'e1',
				sourceId: 'cs1',
				externalId: 'x1',
				title: 'Dentist',
				startsAt: 1_700_000_000_000,
				endsAt: 1_700_003_600_000
			})
			.run();
		db.insert(photoSources).values({ id: 'ps1', kind: 'folder', label: 'Local' }).run();
		db.insert(photos).values({ id: 'p1', sourceId: 'ps1', filePath: '/data/photos/a.jpg' }).run();
		db.insert(chores).values({ id: 'c1', title: 'Feed pets', memberIds: '["kid"]' }).run();
		db.insert(choreCompletions)
			.values({ id: 'cc1', choreId: 'c1', memberId: 'kid', date: '2026-01-02', completedAt: 1 })
			.run();
		db.insert(rewards).values({ id: 'r1', title: 'Ice cream', cost: 10 }).run();
		db.insert(goals).values({ id: 'g1', memberId: 'kid', rewardId: 'r1' }).run();
		db.insert(redemptions)
			.values({ id: 'rd1', rewardId: 'r1', memberId: 'kid', approvedBy: 'mom' })
			.run();
		db.insert(lists).values({ id: 'l1', title: 'Groceries' }).run();
		db.insert(listItems).values({ id: 'li1', listId: 'l1', text: 'Milk' }).run();
		db.insert(mealPlanEntries)
			.values({ id: 'mp1', date: '2026-01-02', meal: 'dinner', title: 'Tacos' })
			.run();
		db.insert(countdowns).values({ id: 'cd1', title: 'Trip', targetDate: '2026-07-01' }).run();
		db.insert(settings).values({ key: 'theme', value: '"dark"' }).run();

		expect(db.select().from(events).get()?.allDay).toBe(false);
		expect(db.select().from(calendarSources).get()?.credentials).toBe('enc:opaque');
		expect(db.select().from(photos).get()?.hidden).toBe(false);
		expect(db.select().from(choreCompletions).get()?.status).toBe('pending');
		expect(db.select().from(members).where(eq(members.id, 'mom')).get()?.role).toBe('adult');
		expect(db.select().from(rewards).get()?.active).toBe(true);
		expect(db.select().from(listItems).get()?.done).toBe(false);
		expect(db.select().from(settings).get()?.value).toBe('"dark"');
		expect(db.select().from(goals).all()).toHaveLength(1);
		expect(db.select().from(redemptions).all()).toHaveLength(1);
		expect(db.select().from(mealPlanEntries).all()).toHaveLength(1);
		expect(db.select().from(countdowns).all()).toHaveLength(1);
		expect(db.select().from(lists).all()).toHaveLength(1);
		expect(db.select().from(photoSources).all()).toHaveLength(1);
		expect(db.select().from(chores).all()).toHaveLength(1);
		expect(db.select().from(events).get()?.startsAt).toBe(1_700_000_000_000);
	});

	it('defaults created_at to epoch milliseconds', () => {
		const db = openDb(':memory:');
		seedMember(db);
		const before = Date.now();
		const row = db.select().from(members).get();
		expect(row?.createdAt).toBeGreaterThan(before - 5_000);
		expect(row?.createdAt).toBeLessThan(before + 5_000);
	});
});

describe('foreign keys', () => {
	it('rejects rows pointing at a missing parent', () => {
		const db = openDb(':memory:');
		expect(() =>
			db
				.insert(starTransactions)
				.values({ id: 't', memberId: 'nobody', delta: 1, reason: 'bonus' })
				.run()
		).toThrow(/FOREIGN KEY/);
	});

	it('cascades member deletion to their ledger', () => {
		const db = openDb(':memory:');
		seedMember(db);
		tx(db, 't1', 'm1', 5, 'bonus');
		db.delete(members).where(eq(members.id, 'm1')).run();
		expect(db.select().from(starTransactions).all()).toEqual([]);
	});

	it('refuses to delete a reward that has redemptions', () => {
		const db = openDb(':memory:');
		seedMember(db);
		db.insert(rewards).values({ id: 'r1', title: 'Toy', cost: 5 }).run();
		db.insert(redemptions).values({ id: 'rd', rewardId: 'r1', memberId: 'm1' }).run();
		expect(() => db.delete(rewards).where(eq(rewards.id, 'r1')).run()).toThrow(/FOREIGN KEY/);
	});
});

describe('starBalance', () => {
	it('is zero for a member with no ledger entries', () => {
		const db = openDb(':memory:');
		seedMember(db);
		expect(starBalance(db, 'm1')).toBe(0);
	});

	it('sums approved deltas, including negative redemptions', () => {
		const db = openDb(':memory:');
		seedMember(db);
		seedMember(db, 'm2');
		tx(db, 't1', 'm1', 5, 'chore');
		tx(db, 't2', 'm1', 3, 'streak');
		tx(db, 't3', 'm1', 2, 'bonus');
		tx(db, 't4', 'm1', -6, 'redemption');
		tx(db, 't5', 'm1', -1, 'adjustment');
		tx(db, 't6', 'm2', 100, 'bonus');
		expect(starBalance(db, 'm1')).toBe(3);
		expect(starBalance(db, 'm2')).toBe(100);
	});

	it('ignores pending and rejected transactions', () => {
		const db = openDb(':memory:');
		seedMember(db);
		tx(db, 't1', 'm1', 4, 'chore');
		tx(db, 't2', 'm1', 10, 'chore', 'pending');
		tx(db, 't3', 'm1', 10, 'chore', 'rejected');
		expect(starBalance(db, 'm1')).toBe(4);
		db.update(starTransactions)
			.set({ status: 'approved' })
			.where(eq(starTransactions.id, 't2'))
			.run();
		expect(starBalance(db, 'm1')).toBe(14);
	});
});
