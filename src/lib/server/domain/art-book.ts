/** A member's archive of posted drawings for the art book (hub-t27j.15, .23): survives note dismissal and expiry. */
import { desc, eq } from 'drizzle-orm';
import type { ArtEntry } from '#lib/domain/drawing-art-book.js';
import type { Db } from '../db/index.js';
import { artArchive } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export function listMemberDrawings(db: Db, memberId: string): ArtEntry[] {
	return db
		.select({ id: artArchive.id, createdAt: artArchive.createdAt })
		.from(artArchive)
		.where(eq(artArchive.memberId, memberId))
		.orderBy(desc(artArchive.createdAt))
		.all()
		.map((r) => ({
			id: r.id,
			createdAt: r.createdAt,
			src: `/api/drawings/posted/${r.id}/image?v=${r.createdAt}`
		}));
}

/** Adult-only (the route enforces it): removes one drawing from the book. */
export function deleteArchivedDrawing(db: Db, id: string): { id: string } {
	const gone = db.delete(artArchive).where(eq(artArchive.id, id)).returning().get();
	if (!gone) throw new LedgerError('not_found', 'Drawing not found');
	return { id };
}
