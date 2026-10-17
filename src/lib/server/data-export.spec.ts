import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

const dir = mkdtempSync(join(tmpdir(), 'hub-export-'));
process.env.DATA_DIR = dir;

const { openDb } = await import('./db/index.js');
const { APP_TABLES, exportAll, importAll } = await import('./data-export.js');
const { EXPORT_TABLES, EXCLUDED_TABLES } = await import('./domain/export.js');
const s = await import('./db/schema.js');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function seed(db: ReturnType<typeof openDb>) {
	db.insert(s.members)
		.values([
			{ id: 'a1', name: 'Test Adult', role: 'adult', color: 'blue', pinHash: 'scrypt$x' },
			{ id: 'k1', name: 'Test Kid', role: 'child', color: 'red' }
		])
		.run();
	db.insert(s.calendarSources)
		.values({ id: 'cs1', provider: 'ics', label: 'Cal', credentials: 'secret-blob', lastSyncAt: 9 })
		.run();
	db.insert(s.events)
		.values({ id: 'e1', sourceId: 'cs1', externalId: 'x', title: 'T', startsAt: 1, endsAt: 2 })
		.run();
	db.insert(s.photoSources).values({ id: 'ps1', kind: 'folder', label: 'Pics' }).run();
	db.insert(s.photos).values({ id: 'ph1', sourceId: 'ps1', filePath: 'a.jpg', hidden: true }).run();
	db.insert(s.chores).values({ id: 'c1', title: 'Dishes', memberIds: '["k1"]' }).run();
	db.insert(s.choreCompletions)
		.values({ id: 'cc1', choreId: 'c1', memberId: 'k1', date: '2026-10-01', completedAt: 5 })
		.run();
	db.insert(s.rewards).values({ id: 'r1', title: 'Ice cream', cost: 5 }).run();
	db.insert(s.starTransactions)
		.values({ id: 't1', memberId: 'k1', delta: 3, reason: 'bonus', createdAt: 7 })
		.run();
	db.insert(s.goals).values({ id: 'g1', memberId: 'k1', rewardId: 'r1' }).run();
	db.insert(s.redemptions)
		.values({ id: 'rd1', rewardId: 'r1', memberId: 'k1', approvedBy: 'a1' })
		.run();
	db.insert(s.lists).values({ id: 'l1', title: 'Groceries' }).run();
	db.insert(s.listItems).values({ id: 'li1', listId: 'l1', text: 'Milk', done: true }).run();
	db.insert(s.mealPlanEntries)
		.values({ id: 'mp1', date: '2026-10-02', meal: 'dinner', title: 'Pasta' })
		.run();
	db.insert(s.countdowns).values({ id: 'cd1', title: 'Trip', targetDate: '2026-12-01' }).run();
	db.insert(s.settings)
		.values([
			{ key: 'household.tz', value: '"UTC"' },
			{ key: 'weather.cache', value: '{}' },
			{ key: 'session.epoch.a1', value: '2' }
		])
		.run();
}

describe('export/import', () => {
	it('classifies every schema table', () => {
		expect(Object.keys(APP_TABLES).sort()).toEqual([...EXPORT_TABLES, ...EXCLUDED_TABLES].sort());
	});

	it('round-trips synthetic data and keeps local state', async () => {
		const db = openDb(join(dir, 'a.db'));
		seed(db);
		const doc = exportAll(db);
		const text = JSON.stringify(doc);
		expect(text).not.toContain('secret-blob');
		expect(doc.tables.settings.map((r) => r.key)).toEqual(['household.tz']);
		expect(doc.reconnect).toEqual([{ table: 'calendar_sources', id: 'cs1', label: 'Cal' }]);
		expect(doc.tables.members[0].pinHash).toBe('scrypt$x');

		// Wipe, add junk that must be replaced, then import.
		db.delete(s.members).run();
		db.delete(s.calendarSources).run();
		db.insert(s.members).values({ id: 'zz', name: 'Gone', role: 'child', color: 'red' }).run();
		db.insert(s.calendarSources)
			.values({ id: 'cs1', provider: 'ics', label: 'Cal', credentials: 'kept' })
			.run();
		db.insert(s.settings)
			.values({ key: 'session.epoch.a1', value: '7' })
			.onConflictDoNothing()
			.run();
		db.update(s.settings).set({ value: '7' }).where(eq(s.settings.key, 'session.epoch.a1')).run();

		const result = await importAll(JSON.parse(text), db);
		expect(result.ok).toBe(true);
		expect(result.ok && result.counts.members).toBe(2);
		expect(readdirSync(join(dir, 'backups')).length).toBe(1);

		const again = exportAll(db, new Date(doc.exportedAt));
		expect(again).toEqual(doc);
		// Same-id source keeps the credentials already on this server; local epoch survives.
		expect(db.select().from(s.calendarSources).get()?.credentials).toBe('kept');
		expect(
			db.select().from(s.settings).where(eq(s.settings.key, 'session.epoch.a1')).get()?.value
		).toBe('7');
		db.$client.close();
	});

	it('refuses a bad document without touching data', async () => {
		const db = openDb(join(dir, 'b.db'));
		seed(db);
		const r = await importAll({ format: 'nope' }, db);
		expect(r).toMatchObject({ ok: false, status: 422 });
		expect(db.select().from(s.members).all()).toHaveLength(2);
		db.$client.close();
	});

	it('rolls back when a row is invalid', async () => {
		const db = openDb(join(dir, 'c.db'));
		seed(db);
		const doc = exportAll(db);
		doc.tables.chore_completions[0].choreId = 'missing';
		const r = await importAll(JSON.parse(JSON.stringify(doc)), db);
		expect(r).toMatchObject({ ok: false, status: 422 });
		expect(db.select().from(s.chores).all()).toHaveLength(1);
		expect(db.select().from(s.members).all()).toHaveLength(2);
		db.$client.close();
	});
});
