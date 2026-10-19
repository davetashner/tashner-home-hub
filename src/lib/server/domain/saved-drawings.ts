/** Saved (unfinished) drawings, a few per member (hub-cn7.7). Format and limits: `#lib/domain/drawing-save.js`. */
import { and, count, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { SAVED_PER_MEMBER, isSavedDrawing } from '#lib/domain/drawing-save.js';
import { parseNoteImage } from '#lib/domain/notes.js';
import type { Db } from '../db/index.js';
import { members, savedDrawings } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export interface SavedDrawingSummary {
	id: string;
	memberId: string;
	memberName: string;
	memberColor: string;
	memberAvatar: string | null;
	thumb: string;
	updatedAt: number;
}
export interface SavedDrawing extends SavedDrawingSummary {
	data: string;
}

export interface SaveInput {
	memberId: unknown;
	data: unknown;
	thumb: unknown;
	/** Present to overwrite one of this member's drawings instead of adding another. */
	id?: unknown;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);
const columns = {
	id: savedDrawings.id,
	memberId: savedDrawings.memberId,
	memberName: members.name,
	memberColor: members.color,
	memberAvatar: members.avatar,
	thumb: savedDrawings.thumb,
	updatedAt: savedDrawings.updatedAt
};

/** Every saved drawing, newest first, without the (large) item data. */
export function listSavedDrawings(db: Db): SavedDrawingSummary[] {
	return db
		.select(columns)
		.from(savedDrawings)
		.innerJoin(members, eq(members.id, savedDrawings.memberId))
		.orderBy(desc(savedDrawings.updatedAt))
		.all();
}

export function getSavedDrawing(db: Db, id: string): SavedDrawing {
	const row = db
		.select({ ...columns, data: savedDrawings.data })
		.from(savedDrawings)
		.innerJoin(members, eq(members.id, savedDrawings.memberId))
		.where(eq(savedDrawings.id, id))
		.get();
	if (!row) throw new LedgerError('not_found', 'Drawing not found');
	return row;
}

/** Adds or overwrites a drawing. Open to every member, children included: no PIN. */
export function saveDrawing(db: Db, input: SaveInput, now = Date.now()): SavedDrawingSummary {
	if (typeof input.memberId !== 'string') throw invalid('memberId is required');
	if (!db.select().from(members).where(eq(members.id, input.memberId)).get())
		throw new LedgerError('not_found', 'Member not found');
	if (!isSavedDrawing(input.data)) throw invalid('data is not a drawing');
	if (parseNoteImage(input.thumb) === null) throw invalid('thumb must be a small PNG data URL');
	const data = input.data as string;
	const thumb = input.thumb as string;
	let id: string;
	if (input.id !== undefined && input.id !== null) {
		if (typeof input.id !== 'string') throw invalid('id must be a string');
		const own = db
			.select({ id: savedDrawings.id })
			.from(savedDrawings)
			.where(and(eq(savedDrawings.id, input.id), eq(savedDrawings.memberId, input.memberId)))
			.get();
		if (!own) throw new LedgerError('not_found', 'Drawing not found');
		id = own.id;
		db.update(savedDrawings)
			.set({ data, thumb, updatedAt: now })
			.where(eq(savedDrawings.id, id))
			.run();
	} else {
		const kept = db
			.select({ n: count() })
			.from(savedDrawings)
			.where(eq(savedDrawings.memberId, input.memberId))
			.get();
		if ((kept?.n ?? 0) >= SAVED_PER_MEMBER)
			throw new LedgerError('conflict', `Only ${SAVED_PER_MEMBER} drawings fit: delete one first`);
		id = randomUUID();
		db.insert(savedDrawings)
			.values({ id, memberId: input.memberId, data, thumb, createdAt: now, updatedAt: now })
			.run();
	}
	return listSavedDrawings(db).find((d) => d.id === id) as SavedDrawingSummary;
}

export function deleteSavedDrawing(db: Db, id: string): { ok: true } {
	const res = db.delete(savedDrawings).where(eq(savedDrawings.id, id)).run();
	if (res.changes === 0) throw new LedgerError('not_found', 'Drawing not found');
	return { ok: true };
}
