import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { members } from '../db/schema.js';
import { createNote } from './notes.js';
import { listMemberDrawings } from './art-book.js';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	for (const id of ['kid', 'sib'])
		db.insert(members)
			.values({ id, name: `Kid ${id}`, role: 'child', color: 'member-2' })
			.run();
});

describe('listMemberDrawings', () => {
	it("lists only that member's drawn notes, newest first, with dates", () => {
		const a = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		const b = createNote(db, { authorId: 'kid', body: '', image: PNG }, 2000);
		createNote(db, { authorId: 'sib', body: '', image: PNG }, 1500);
		createNote(db, { authorId: 'kid', body: 'text only' }, 3000);
		expect(listMemberDrawings(db, 'kid', 3000)).toEqual([
			{ id: b.id, createdAt: 2000, src: `/api/notes/${b.id}/image?v=2000` },
			{ id: a.id, createdAt: 1000, src: `/api/notes/${a.id}/image?v=1000` }
		]);
	});
	it('skips expired drawings and is empty for an unknown member', () => {
		createNote(db, { authorId: 'kid', body: '', image: PNG, until: 'today' }, 1000);
		expect(listMemberDrawings(db, 'kid', Date.now() + 10 * 86_400_000)).toEqual([]);
		expect(listMemberDrawings(db, 'nobody')).toEqual([]);
	});
});
