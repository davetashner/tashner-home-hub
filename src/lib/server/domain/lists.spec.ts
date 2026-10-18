import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_LISTS } from '#lib/domain/lists.js';
import { openDb, type Db } from '../db/index.js';
import { lists, settings } from '../db/schema.js';
import { createList, deleteList, listAll, LISTS_SEEDED_KEY } from './lists.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const flag = () => db.select().from(settings).where(eq(settings.key, LISTS_SEEDED_KEY)).get();

describe('default list seeding', () => {
	it('seeds the defaults on a fresh install and records the flag', () => {
		expect(listAll(db).map((l) => l.title)).toEqual([...DEFAULT_LISTS]);
		expect(flag()).toBeDefined();
	});
	it('does not bring the defaults back after every list is deleted', () => {
		for (const l of listAll(db)) deleteList(db, l.id);
		expect(listAll(db)).toEqual([]);
		expect(listAll(db)).toEqual([]);
	});
	it('does not re-add a single deleted default', () => {
		const [first] = listAll(db);
		deleteList(db, first.id);
		expect(listAll(db).map((l) => l.title)).not.toContain(first.title);
	});
	it('treats an install that already has lists as seeded, without adding defaults', () => {
		db.insert(lists).values({ id: 'x', title: 'Mine' }).run();
		expect(listAll(db).map((l) => l.title)).toEqual(['Mine']);
		expect(flag()).toBeDefined();
		deleteList(db, 'x');
		expect(listAll(db)).toEqual([]);
	});
	it('keeps lists created later', () => {
		listAll(db);
		createList(db, 'Zoo');
		expect(listAll(db).map((l) => l.title)).toContain('Zoo');
	});
});
