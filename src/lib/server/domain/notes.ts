/** Sticky-note storage (requirements MSG-1). Ordering and expiry maths: `#lib/domain/notes.js`. */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	DEFAULT_NOTE_COLOR,
	cleanNoteBody,
	expiryFor,
	isNoteColor,
	isUntil,
	visibleNotes,
	NOTE_MAX
} from '#lib/domain/notes.js';
import type { Db } from '../db/index.js';
import { members, notes } from '../db/schema.js';
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
}

export interface NoteInput {
	authorId: unknown;
	body: unknown;
	color?: unknown;
	/** 'today' | 'tomorrow' | 'week'; absent or null keeps the note until dismissed. */
	until?: unknown;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

const view = (db: Db, id: string): NoteView | undefined =>
	db
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
			authorAvatar: members.avatar
		})
		.from(notes)
		.innerJoin(members, eq(members.id, notes.authorId))
		.where(eq(notes.id, id))
		.get();

/** Posts a note. Open to every member, children included: no PIN. */
export function createNote(db: Db, input: NoteInput, now = Date.now()): NoteView {
	const body = cleanNoteBody(input.body);
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
			expiresAt: expiryFor(untilRaw, now, householdTimeZone(db))
		})
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
