/** Posted drawings for the idle photo frame (hub-cn7.28): the note PNGs, newest first, with the artist's first name. */
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { firstName, type FrameDrawing } from '#lib/domain/drawing-frame.js';
import type { Db } from '../db/index.js';
import { members, notes } from '../db/schema.js';

export function listFrameDrawings(db: Db, limit = 50, now = Date.now()): FrameDrawing[] {
	return db
		.select({ id: notes.id, name: members.name, createdAt: notes.createdAt })
		.from(notes)
		.innerJoin(members, eq(members.id, notes.authorId))
		.where(and(isNotNull(notes.image), or(isNull(notes.expiresAt), gt(notes.expiresAt, now))))
		.orderBy(desc(notes.createdAt))
		.limit(limit)
		.all()
		.map((r) => ({
			id: r.id,
			name: firstName(r.name),
			src: `/api/notes/${r.id}/image?v=${r.createdAt}`
		}));
}
