import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_LISTS } from '#lib/domain/lists.js';
import { openDb, type Db } from '../db/index.js';
import { lists, members, settings } from '../db/schema.js';
import { createMember } from './members.js';
import { createList, deleteList, listAll, LISTS_SEEDED_KEY, setOwner } from './lists.js';

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

describe('list owners', () => {
	const adult = () => createMember(db, { name: 'Parent One', role: 'adult', color: 'member-1' });

	it('starts as House and can be reassigned to an adult and back', () => {
		const [first] = listAll(db);
		expect(first.ownerId).toBeNull();
		const a = adult();
		expect(setOwner(db, first.id, a.id).ownerId).toBe(a.id);
		expect(listAll(db)[0].ownerId).toBe(a.id);
		expect(setOwner(db, first.id, null).ownerId).toBeNull();
		expect(listAll(db)[0].ownerId).toBeNull();
	});
	it('rejects kids, strangers and junk, and unknown lists', () => {
		const [first] = listAll(db);
		const kid = createMember(db, { name: 'Kid A', role: 'child', color: 'member-2' });
		expect(() => setOwner(db, first.id, kid.id)).toThrow();
		expect(() => setOwner(db, first.id, 'nobody')).toThrow();
		expect(() => setOwner(db, first.id, 7)).toThrow();
		expect(() => setOwner(db, 'nope', null)).toThrow(/not found/i);
	});
	it('falls back to House when the owning adult is deleted', () => {
		const [first] = listAll(db);
		const a = adult();
		createMember(db, { name: 'Parent Two', role: 'adult', color: 'member-3' });
		setOwner(db, first.id, a.id);
		db.delete(members).where(eq(members.id, a.id)).run();
		expect(listAll(db)[0].ownerId).toBeNull();
	});
});
