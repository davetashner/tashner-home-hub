/** Countdown storage (requirements CD-1). Day math lives in `#lib/domain/countdowns.js`. */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { COUNTDOWN_TITLE_MAX, isCalendarDate } from '#lib/domain/countdowns.js';
import { dateKeyOf, utcDateKey } from '#lib/domain/calendar-view/zone.js';
import type { Db } from '../db/index.js';
import { countdowns, events } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export type Countdown = typeof countdowns.$inferSelect;

/** A countdown as served: linked ones say whether their calendar event still exists. */
export interface CountdownView extends Countdown {
	/** True when the countdown was made from a calendar event that has since gone away. */
	eventMissing: boolean;
	/** The linked event's current row id, so a calendar view can tell it is already counting. */
	eventId: string | null;
}

export interface CountdownInput {
	title: string;
	targetDate: string;
	/** A single emoji, or null for none. */
	icon?: string | null;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function validTitle(v: unknown): string {
	const t = typeof v === 'string' ? v.trim() : '';
	if (t.length < 1 || t.length > COUNTDOWN_TITLE_MAX)
		throw invalid(`title must be 1-${COUNTDOWN_TITLE_MAX} characters`);
	return t;
}

function validDate(v: unknown): string {
	if (!isCalendarDate(v)) throw invalid('date must be a real day, YYYY-MM-DD');
	return v;
}

function validIcon(v: unknown): string | null {
	if (v === null || v === undefined || v === '') return null;
	const ok =
		typeof v === 'string' &&
		[...segmenter.segment(v)].length === 1 &&
		/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(v);
	if (!ok) throw invalid('icon must be a single emoji');
	return v;
}

export function createCountdown(db: Db, input: CountdownInput): Countdown {
	return db
		.insert(countdowns)
		.values({
			id: randomUUID(),
			title: validTitle(input.title),
			targetDate: validDate(input.targetDate),
			icon: validIcon(input.icon)
		})
		.returning()
		.get();
}

/** Updates only the fields present in `patch`. */
export function updateCountdown(db: Db, id: string, patch: Partial<CountdownInput>): Countdown {
	const set: Partial<typeof countdowns.$inferInsert> = {};
	if (patch.title !== undefined) set.title = validTitle(patch.title);
	if (patch.targetDate !== undefined) set.targetDate = validDate(patch.targetDate);
	if (patch.icon !== undefined) set.icon = validIcon(patch.icon);
	return db.transaction((tx) => {
		const existing = tx.select().from(countdowns).where(eq(countdowns.id, id)).get();
		if (!existing) throw new LedgerError('not_found', 'Countdown not found');
		if (existing.eventExternalId && (set.title !== undefined || set.targetDate !== undefined))
			throw invalid('this countdown follows its calendar event: change the event instead');
		if (Object.keys(set).length === 0) return existing;
		return tx.update(countdowns).set(set).where(eq(countdowns.id, id)).returning().get();
	});
}

export function deleteCountdown(db: Db, id: string): { id: string } {
	const gone = db.delete(countdowns).where(eq(countdowns.id, id)).returning().get();
	if (!gone) throw new LedgerError('not_found', 'Countdown not found');
	return { id };
}

type EventRow = typeof events.$inferSelect;

/** The household-local day an event starts on: all-day events are stored at UTC midnight. */
function eventDay(e: EventRow, timeZone: string): string {
	return e.allDay ? utcDateKey(e.startsAt) : dateKeyOf(e.startsAt, timeZone);
}

const eventTitle = (e: EventRow) => e.title.trim().slice(0, COUNTDOWN_TITLE_MAX) || 'Event';

/**
 * CD-4: a countdown to a calendar event, by the event's row id. Anyone may add one. One per
 * event: asking again returns the existing countdown.
 */
export function createCountdownFromEvent(
	db: Db,
	eventId: unknown,
	timeZone: string,
	icon?: string | null
): { countdown: Countdown; created: boolean } {
	if (typeof eventId !== 'string' || !eventId) throw invalid('eventId is required');
	const ev = db.select().from(events).where(eq(events.id, eventId)).get();
	if (!ev) throw new LedgerError('not_found', 'Event not found');
	const existing = db
		.select()
		.from(countdowns)
		.where(
			and(eq(countdowns.eventSourceId, ev.sourceId), eq(countdowns.eventExternalId, ev.externalId))
		)
		.get();
	if (existing) return { countdown: existing, created: false };
	const countdown = db
		.insert(countdowns)
		.values({
			id: randomUUID(),
			title: eventTitle(ev),
			targetDate: eventDay(ev, timeZone),
			icon: validIcon(icon),
			eventSourceId: ev.sourceId,
			eventExternalId: ev.externalId
		})
		.returning()
		.get();
	return { countdown, created: true };
}

/**
 * Every countdown, soonest first. Expired ones are kept so a grown-up can still tidy them.
 * Linked countdowns follow their event: a moved or renamed event updates the countdown (and is
 * saved, so the last known date survives the event being deleted).
 */
export function listCountdowns(db: Db, timeZone = 'UTC'): CountdownView[] {
	const rows = db.select().from(countdowns).all();
	const out: CountdownView[] = [];
	for (const c of rows) {
		if (!c.eventSourceId || !c.eventExternalId) {
			out.push({ ...c, eventMissing: false, eventId: null });
			continue;
		}
		const ev = db
			.select()
			.from(events)
			.where(and(eq(events.sourceId, c.eventSourceId), eq(events.externalId, c.eventExternalId)))
			.get();
		if (!ev) {
			out.push({ ...c, eventMissing: true, eventId: null });
			continue;
		}
		const next = { title: eventTitle(ev), targetDate: eventDay(ev, timeZone) };
		if (next.title !== c.title || next.targetDate !== c.targetDate)
			db.update(countdowns).set(next).where(eq(countdowns.id, c.id)).run();
		out.push({ ...c, ...next, eventMissing: false, eventId: ev.id });
	}
	return out.sort(
		(a, b) => a.targetDate.localeCompare(b.targetDate) || a.title.localeCompare(b.title)
	);
}

/** Turns a linked countdown whose event went away into a plain one that keeps its date. */
export function unlinkCountdown(db: Db, id: string): Countdown {
	const row = db
		.update(countdowns)
		.set({ eventSourceId: null, eventExternalId: null })
		.where(eq(countdowns.id, id))
		.returning()
		.get();
	if (!row) throw new LedgerError('not_found', 'Countdown not found');
	return row;
}
