import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { members } from '../db/schema.js';
import { subscribe } from './events.js';
import { createNote, dismissNote, listNotes, noteImage, pinNote } from './notes.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members)
		.values([
			{ id: 'kid', name: 'Kid A', role: 'child', color: 'member-2', avatar: '🦊' },
			{ id: 'mom', name: 'Parent One', role: 'adult', color: 'member-1' }
		])
		.run();
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('note storage', () => {
	it('posts with the author joined in and defaults', () => {
		const n = createNote(db, { authorId: 'kid', body: ' Out of milk ' }, 1000);
		expect(n).toMatchObject({
			body: 'Out of milk',
			color: 'note-yellow',
			pinned: false,
			expiresAt: null,
			authorName: 'Kid A',
			authorAvatar: '🦊'
		});
	});
	it('rejects bad input', () => {
		expect(code(() => createNote(db, { authorId: 'kid', body: ' ' }))).toBe('invalid');
		expect(code(() => createNote(db, { authorId: 'kid', body: 'x'.repeat(141) }))).toBe('invalid');
		expect(code(() => createNote(db, { authorId: 'kid', body: 'x', color: 'red' }))).toBe(
			'invalid'
		);
		expect(code(() => createNote(db, { authorId: 'kid', body: 'x', until: 'year' }))).toBe(
			'invalid'
		);
		expect(code(() => createNote(db, { authorId: 'nobody', body: 'x' }))).toBe('not_found');
		expect(code(() => createNote(db, { authorId: 5, body: 'x' }))).toBe('invalid');
	});
	it('lists pinned first then newest and sweeps expired notes', () => {
		const t = Date.parse('2027-03-10T12:00:00Z');
		createNote(db, { authorId: 'kid', body: 'first' }, t);
		const b = createNote(db, { authorId: 'mom', body: 'today only', until: 'today' }, t + 1);
		createNote(db, { authorId: 'kid', body: 'third' }, t + 2);
		expect(listNotes(db, t + 10).map((n) => n.body)).toEqual(['third', 'today only', 'first']);
		pinNote(db, b.id, true);
		expect(listNotes(db, t + 10)[0].body).toBe('today only');
		const next = t + 13 * 3600_000; // past local midnight if the zone is UTC; assert via expiresAt
		expect(listNotes(db, Math.max(next, b.expiresAt!)).map((n) => n.body)).toEqual([
			'third',
			'first'
		]);
	});
	it('dismisses and pins, publishing a change', () => {
		const n = createNote(db, { authorId: 'kid', body: 'hi' });
		const seen = vi.fn();
		const off = subscribe(['notes'], seen)!;
		expect(pinNote(db, n.id, true).pinned).toBe(true);
		expect(code(() => pinNote(db, n.id, 'yes'))).toBe('invalid');
		expect(code(() => pinNote(db, 'nope', true))).toBe('not_found');
		expect(dismissNote(db, n.id)).toEqual({ id: n.id });
		expect(code(() => dismissNote(db, n.id))).toBe('not_found');
		expect(seen).toHaveBeenCalledTimes(2);
		off();
		expect(listNotes(db)).toEqual([]);
	});
});

describe('drawing notes', () => {
	const PNG =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	it('posts a drawing with no caption and serves its bytes', () => {
		const n = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		expect(n.body).toBe('');
		expect(n.imageUrl).toBe(`/api/notes/${n.id}/image?v=1000`);
		const bytes = noteImage(db, n.id);
		expect(bytes?.[1]).toBe(0x50);
		expect(listNotes(db, 2000)[0].imageUrl).toBe(n.imageUrl);
	});
	it('keeps a caption when given and leaves text notes imageless', () => {
		expect(createNote(db, { authorId: 'kid', body: 'Look', image: PNG }).body).toBe('Look');
		const t = createNote(db, { authorId: 'kid', body: 'text' });
		expect(t.imageUrl).toBeNull();
		expect(noteImage(db, t.id)).toBeNull();
		expect(noteImage(db, 'missing')).toBeNull();
	});
	it('rejects a bad image, and a missing body without one', () => {
		expect(code(() => createNote(db, { authorId: 'kid', body: '', image: 'data:x' }))).toBe(
			'invalid'
		);
		expect(code(() => createNote(db, { authorId: 'kid', body: '' }))).toBe('invalid');
	});
	it('frees the image when the note is dismissed or expires', () => {
		const a = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		dismissNote(db, a.id);
		expect(noteImage(db, a.id)).toBeNull();
		const b = createNote(db, { authorId: 'kid', body: '', image: PNG, until: 'today' }, 1000);
		listNotes(db, 1000 + 3 * 86_400_000);
		expect(noteImage(db, b.id)).toBeNull();
	});
});
