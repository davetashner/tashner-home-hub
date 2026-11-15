import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { members } from '../db/schema.js';
import { archivedImage, createNote, dismissNote, listNotes, noteImage } from './notes.js';
import { deleteArchivedDrawing, listMemberDrawings } from './art-book.js';

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
		expect(listMemberDrawings(db, 'kid')).toEqual([
			{ id: b.id, createdAt: 2000, src: `/api/drawings/posted/${b.id}/image?v=2000` },
			{ id: a.id, createdAt: 1000, src: `/api/drawings/posted/${a.id}/image?v=1000` }
		]);
		expect(listMemberDrawings(db, 'nobody')).toEqual([]);
	});

	it('keeps a drawing after its note is dismissed, with the image still served', () => {
		const n = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		dismissNote(db, n.id);
		expect(listMemberDrawings(db, 'kid').map((d) => d.id)).toEqual([n.id]);
		expect(noteImage(db, n.id)).toBeNull();
		expect(archivedImage(db, n.id)).not.toBeNull();
	});

	it('keeps a drawing after its note expires and is swept', () => {
		const n = createNote(db, { authorId: 'kid', body: '', image: PNG, until: 'today' }, 1000);
		expect(listNotes(db, Date.now() + 10 * 86_400_000)).toEqual([]);
		expect(listMemberDrawings(db, 'kid').map((d) => d.id)).toEqual([n.id]);
		expect(archivedImage(db, n.id)?.length).toBeGreaterThan(0);
	});
});

describe('deleteArchivedDrawing', () => {
	it('removes the drawing from the book and its image', () => {
		const n = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		dismissNote(db, n.id);
		expect(deleteArchivedDrawing(db, n.id)).toEqual({ id: n.id });
		expect(listMemberDrawings(db, 'kid')).toEqual([]);
		expect(archivedImage(db, n.id)).toBeNull();
	});
	it('says not_found for an unknown drawing', () => {
		expect(() => deleteArchivedDrawing(db, 'nope')).toThrow(/not found/i);
	});
});
