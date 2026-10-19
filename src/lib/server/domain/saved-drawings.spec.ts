import { beforeEach, describe, expect, it } from 'vitest';
import { SAVED_PER_MEMBER, serializeDrawing } from '#lib/domain/drawing-save.js';
import { openDb, type Db } from '../db/index.js';
import { members } from '../db/schema.js';
import {
	deleteSavedDrawing,
	getSavedDrawing,
	listSavedDrawings,
	saveDrawing
} from './saved-drawings.js';

// A 1x1 PNG.
const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const data = serializeDrawing(
	[{ tool: 'pen', color: 'draw-red', points: [{ x: 1, y: 1, w: 7 }] }],
	{ w: 100, h: 50 }
);

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	db.insert(members)
		.values([
			{ id: 'a', name: 'Kid A', role: 'child', color: 'member-2', avatar: '🦊' },
			{ id: 'b', name: 'Kid B', role: 'child', color: 'member-3' }
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

describe('saved drawings', () => {
	it('saves, lists without data, and reopens with it', () => {
		const s = saveDrawing(db, { memberId: 'a', data, thumb: PNG }, 1000);
		expect(s).toMatchObject({ memberName: 'Kid A', memberAvatar: '🦊', updatedAt: 1000 });
		expect(s).not.toHaveProperty('data');
		const [row] = listSavedDrawings(db);
		expect(row.id).toBe(s.id);
		expect(row).not.toHaveProperty('data');
		expect(getSavedDrawing(db, s.id).data).toBe(data);
	});
	it('lists newest first', () => {
		const old = saveDrawing(db, { memberId: 'a', data, thumb: PNG }, 1000);
		const fresh = saveDrawing(db, { memberId: 'b', data, thumb: PNG }, 2000);
		expect(listSavedDrawings(db).map((d) => d.id)).toEqual([fresh.id, old.id]);
	});
	it('overwrites an own drawing instead of adding one', () => {
		const s = saveDrawing(db, { memberId: 'a', data, thumb: PNG }, 1000);
		const again = saveDrawing(db, { memberId: 'a', data, thumb: PNG, id: s.id }, 3000);
		expect(again).toMatchObject({ id: s.id, updatedAt: 3000 });
		expect(listSavedDrawings(db)).toHaveLength(1);
	});
	it('refuses to overwrite someone else’s drawing', () => {
		const s = saveDrawing(db, { memberId: 'a', data, thumb: PNG });
		expect(code(() => saveDrawing(db, { memberId: 'b', data, thumb: PNG, id: s.id }))).toBe(
			'not_found'
		);
		expect(code(() => saveDrawing(db, { memberId: 'a', data, thumb: PNG, id: 5 }))).toBe('invalid');
	});
	it('rejects bad input', () => {
		expect(code(() => saveDrawing(db, { memberId: 1, data, thumb: PNG }))).toBe('invalid');
		expect(code(() => saveDrawing(db, { memberId: 'zz', data, thumb: PNG }))).toBe('not_found');
		expect(code(() => saveDrawing(db, { memberId: 'a', data: 'nope', thumb: PNG }))).toBe(
			'invalid'
		);
		expect(code(() => saveDrawing(db, { memberId: 'a', data, thumb: 'x' }))).toBe('invalid');
	});
	it('caps drawings per member', () => {
		for (let i = 0; i < SAVED_PER_MEMBER; i++) saveDrawing(db, { memberId: 'a', data, thumb: PNG });
		expect(code(() => saveDrawing(db, { memberId: 'a', data, thumb: PNG }))).toBe('conflict');
		expect(code(() => saveDrawing(db, { memberId: 'b', data, thumb: PNG }))).toBe('none');
	});
	it('deletes, and 404s on the unknown', () => {
		const s = saveDrawing(db, { memberId: 'a', data, thumb: PNG });
		expect(deleteSavedDrawing(db, s.id)).toEqual({ ok: true });
		expect(code(() => deleteSavedDrawing(db, s.id))).toBe('not_found');
		expect(code(() => getSavedDrawing(db, s.id))).toBe('not_found');
	});
	it('goes away with its member', () => {
		saveDrawing(db, { memberId: 'a', data, thumb: PNG });
		db.$client.prepare("delete from members where id = 'a'").run();
		expect(listSavedDrawings(db)).toHaveLength(0);
	});
});
