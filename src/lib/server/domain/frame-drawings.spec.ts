import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { members } from '../db/schema.js';
import { createNote } from './notes.js';
import { listFrameDrawings } from './frame-drawings.js';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members)
		.values({ id: 'kid', name: 'Kid Alpha', role: 'child', color: 'member-2' })
		.run();
});

describe('listFrameDrawings', () => {
	it('lists drawn notes newest first with the first name only', () => {
		const a = createNote(db, { authorId: 'kid', body: '', image: PNG }, 1000);
		const b = createNote(db, { authorId: 'kid', body: '', image: PNG }, 2000);
		createNote(db, { authorId: 'kid', body: 'text only' }, 3000);
		expect(listFrameDrawings(db, 50, 3000)).toEqual([
			{ id: b.id, name: 'Kid', src: `/api/notes/${b.id}/image?v=2000` },
			{ id: a.id, name: 'Kid', src: `/api/notes/${a.id}/image?v=1000` }
		]);
	});
	it('skips expired notes and honours the limit', () => {
		createNote(db, { authorId: 'kid', body: '', image: PNG, until: 'today' }, 1000);
		createNote(db, { authorId: 'kid', body: '', image: PNG }, 2000);
		expect(listFrameDrawings(db, 50, Date.now() + 10 * 86_400_000)).toHaveLength(1);
		expect(listFrameDrawings(db, 1, 3000)).toHaveLength(1);
	});
});
