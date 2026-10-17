/** Countdown storage (requirements CD-1). Day math lives in `#lib/domain/countdowns.js`. */
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { COUNTDOWN_TITLE_MAX, isCalendarDate } from '#lib/domain/countdowns.js';
import type { Db } from '../db/index.js';
import { countdowns } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export type Countdown = typeof countdowns.$inferSelect;

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
		if (Object.keys(set).length === 0) return existing;
		return tx.update(countdowns).set(set).where(eq(countdowns.id, id)).returning().get();
	});
}

export function deleteCountdown(db: Db, id: string): { id: string } {
	const gone = db.delete(countdowns).where(eq(countdowns.id, id)).returning().get();
	if (!gone) throw new LedgerError('not_found', 'Countdown not found');
	return { id };
}

/** Every countdown, soonest first. Expired ones are kept so a grown-up can still tidy them. */
export function listCountdowns(db: Db): Countdown[] {
	return db
		.select()
		.from(countdowns)
		.orderBy(asc(countdowns.targetDate), asc(countdowns.title))
		.all();
}
