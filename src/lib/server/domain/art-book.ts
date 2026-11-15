/** A member's posted drawings with their dates for the art book (hub-t27j.15): oldest to newest is the client's job. */
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { ArtEntry } from '#lib/domain/drawing-art-book.js';
import type { Db } from '../db/index.js';
import { notes } from '../db/schema.js';

export function listMemberDrawings(db: Db, memberId: string, now = Date.now()): ArtEntry[] {
	return db
		.select({ id: notes.id, createdAt: notes.createdAt })
		.from(notes)
		.where(
			and(
				eq(notes.authorId, memberId),
				isNotNull(notes.image),
				or(isNull(notes.expiresAt), gt(notes.expiresAt, now))
			)
		)
		.orderBy(desc(notes.createdAt))
		.all()
		.map((r) => ({
			id: r.id,
			createdAt: r.createdAt,
			src: `/api/notes/${r.id}/image?v=${r.createdAt}`
		}));
}
