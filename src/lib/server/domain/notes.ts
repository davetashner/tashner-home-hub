/** Sticky-note storage (requirements MSG-1). Ordering and expiry maths: `#lib/domain/notes.js`. */
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	DEFAULT_NOTE_COLOR,
	cleanNoteBody,
	expiryFor,
	isNoteColor,
	isUntil,
	parseNoteFrames,
	parseNoteImage,
	visibleNotes,
	NOTE_MAX
} from '#lib/domain/notes.js';
import type { Db } from '../db/index.js';
import { artArchive, members, notes } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { publish } from './events.js';
import { LedgerError } from './ledger.js';

export interface NoteView {
	id: string;
	body: string;
	color: string;
	pinned: boolean;
	createdAt: number;
	expiresAt: number | null;
	authorId: string;
	authorName: string;
	authorColor: string;
	authorAvatar: string | null;
	/** URL of the drawing, or null for a text note. */
	imageUrl: string | null;
	/** Extra Wiggle frames (empty unless drawn with Wiggle on); cycle [imageUrl, ...frameUrls]. */
	frameUrls: string[];
}

export interface NoteInput {
	authorId: unknown;
	body: unknown;
	color?: unknown;
	/** 'today' | 'tomorrow' | 'week'; absent or null keeps the note until dismissed. */
	until?: unknown;
	/** Optional drawing: a `data:image/png;base64,` URL of at most NOTE_IMAGE_MAX_BYTES. */
	image?: unknown;
	/** Optional Wiggle frames: two small PNG data URLs, only with an image (hub-t27j.21). */
	frames?: unknown;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

const view = (db: Db, id: string): NoteView | undefined => {
	const row = db
		.select({
			id: notes.id,
			body: notes.body,
			color: notes.color,
			pinned: notes.pinned,
			createdAt: notes.createdAt,
			expiresAt: notes.expiresAt,
			authorId: notes.authorId,
			authorName: members.name,
			authorColor: members.color,
			authorAvatar: members.avatar,
			hasImage: sql<number>`${notes.image} is not null`,
			frames: notes.imageFrames
		})
		.from(notes)
		.innerJoin(members, eq(members.id, notes.authorId))
		.where(eq(notes.id, id))
		.get();
	if (!row) return undefined;
	const { hasImage, frames, ...rest } = row;
	// The timestamp busts the browser cache if an id were ever reused.
	const url = (f: number) => `/api/notes/${id}/image?v=${row.createdAt}${f ? `&f=${f}` : ''}`;
	const extra = hasImage && frames ? (JSON.parse(frames) as string[]) : [];
	return {
		...rest,
		imageUrl: hasImage ? url(0) : null,
		frameUrls: extra.map((_, i) => url(i + 1))
	};
};

/** The drawing's PNG bytes, or null when the note is gone or has none. */
export function noteImage(db: Db, id: string): Buffer | null {
	return db.select({ image: notes.image }).from(notes).where(eq(notes.id, id)).get()?.image ?? null;
}

/** Extra Wiggle frame `f` (1-based) as PNG bytes, or null when the note has no such frame. */
export function noteFrame(db: Db, id: string, f: number): Buffer | null {
	const raw = db.select({ f: notes.imageFrames }).from(notes).where(eq(notes.id, id)).get()?.f;
	if (!raw) return null;
	const url = (JSON.parse(raw) as string[])[f - 1];
	return url ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : null;
}

/** A posted drawing's PNG from the art book archive, which outlives its note. */
export function archivedImage(db: Db, id: string): Buffer | null {
	return (
		db.select({ image: artArchive.image }).from(artArchive).where(eq(artArchive.id, id)).get()
			?.image ?? null
	);
}

/** Posts a note. Open to every member, children included: no PIN. */
export function createNote(db: Db, input: NoteInput, now = Date.now()): NoteView {
	const hasImage = input.image !== undefined && input.image !== null;
	const image = hasImage ? parseNoteImage(input.image) : null;
	if (hasImage && image === null) throw invalid('image must be a small PNG data URL');
	const hasFrames = input.frames !== undefined && input.frames !== null;
	if (hasFrames && (image === null || parseNoteFrames(input.frames) === null))
		throw invalid('frames must be two small PNG data URLs and need an image');
	// A drawing may stand alone; a caption is optional then.
	const caption =
		image !== null && (input.body === undefined || input.body === null || input.body === '')
			? ''
			: null;
	const body = caption ?? cleanNoteBody(input.body);
	if (body === null) throw invalid(`note must be 1-${NOTE_MAX} characters`);
	if (typeof input.authorId !== 'string') throw invalid('authorId is required');
	if (!db.select().from(members).where(eq(members.id, input.authorId)).get())
		throw new LedgerError('not_found', 'Author not found');
	const color = input.color ?? DEFAULT_NOTE_COLOR;
	if (!isNoteColor(color)) throw invalid('unknown note color');
	const untilRaw = input.until ?? null;
	if (untilRaw !== null && !isUntil(untilRaw))
		throw invalid('until must be today, tomorrow or week');
	const id = randomUUID();
	db.insert(notes)
		.values({
			id,
			authorId: input.authorId,
			body,
			color,
			createdAt: now,
			expiresAt: expiryFor(untilRaw, now, householdTimeZone(db)),
			image: image === null ? null : Buffer.from(image),
			imageFrames: hasFrames ? JSON.stringify(input.frames) : null
		})
		.run();
	if (image !== null)
		db.insert(artArchive)
			.values({ id, memberId: input.authorId, createdAt: now, image: Buffer.from(image) })
			.run();
	publish('notes', { kind: 'note', noteId: id });
	return view(db, id) as NoteView;
}

/** Live notes in display order; expired rows are swept as a side effect. */
export function listNotes(db: Db, now = Date.now()): NoteView[] {
	db.delete(notes)
		.where(and(isNotNull(notes.expiresAt), lte(notes.expiresAt, now)))
		.run();
	const rows = db.select({ id: notes.id }).from(notes).all();
	return visibleNotes(
		rows.map((r) => view(db, r.id) as NoteView),
		now
	);
}

/** Anyone can take a note down. */
export function dismissNote(db: Db, id: string): { id: string } {
	const gone = db.delete(notes).where(eq(notes.id, id)).returning().get();
	if (!gone) throw new LedgerError('not_found', 'Note not found');
	publish('notes', { kind: 'note', noteId: id });
	return { id };
}

/** Pinning is adult-only; the route enforces that. */
export function pinNote(db: Db, id: string, pinned: unknown): NoteView {
	if (typeof pinned !== 'boolean') throw invalid('pinned must be true or false');
	const hit = db.update(notes).set({ pinned }).where(eq(notes.id, id)).returning().get();
	if (!hit) throw new LedgerError('not_found', 'Note not found');
	publish('notes', { kind: 'note', noteId: id });
	return view(db, id) as NoteView;
}
