/**
 * Stars for the daily drawing prompt (hub-t27j.8). One approved `drawing` ledger row per kid per
 * household day (ref = the day), so the balance and the streak both come from the ledger. Pure
 * rules: `#lib/domain/drawing-stars.js`.
 */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	DRAWING_STAR_REASON,
	DRAWING_STAR_VALUE,
	drawingStreak,
	type StarInfo
} from '#lib/domain/drawing-stars.js';
import { parsePromptsEnabled } from '#lib/domain/drawing-prompts.js';
import { localDate } from '#lib/domain/kid-chores.js';
import type { Db } from '../db/index.js';
import { members, settings, starTransactions } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { LedgerError } from './ledger.js';

export const DRAWING_STARS_KEY = 'drawing.stars';

function flag(db: Db, key: string): boolean {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	if (!row) return true;
	try {
		return parsePromptsEnabled(JSON.parse(row.value));
	} catch {
		return true;
	}
}

/**
 * The stars setting (default on). The board only asks for a star while the daily prompt shows, so
 * turning prompts off already stops new stars.
 */
export const drawingStarsEnabled = (db: Db): boolean => flag(db, DRAWING_STARS_KEY);

export function setDrawingStarsEnabled(db: Db, enabled: boolean): void {
	const value = JSON.stringify(enabled);
	db.insert(settings)
		.values({ key: DRAWING_STARS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}
export const readDrawingStarsSetting = drawingStarsEnabled;

const earnedDays = (db: Db, memberId: string): string[] =>
	db
		.select({ refId: starTransactions.refId })
		.from(starTransactions)
		.where(
			and(
				eq(starTransactions.memberId, memberId),
				eq(starTransactions.reason, DRAWING_STAR_REASON),
				eq(starTransactions.status, 'approved')
			)
		)
		.all()
		.flatMap((r) => (r.refId ? [r.refId] : []));

export interface AwardResult {
	awarded: boolean;
	streak: number;
}

/** Awards today's star to a child unless it is off or already earned today. Idempotent. */
export function awardDrawingStar(db: Db, memberId: unknown, now = Date.now()): AwardResult {
	if (typeof memberId !== 'string' || !memberId)
		throw new LedgerError('invalid', 'memberId must be a non-empty string');
	const today = localDate(now, householdTimeZone(db));
	// One connection, synchronous: the whole check-and-insert runs inside this transaction.
	return db.transaction((tx) => {
		const member = tx.select().from(members).where(eq(members.id, memberId)).get();
		if (!member) throw new LedgerError('not_found', 'Member not found');
		const days = earnedDays(db, memberId);
		if (member.role !== 'child' || !drawingStarsEnabled(db))
			return { awarded: false, streak: drawingStreak(days, today) };
		if (days.includes(today)) return { awarded: false, streak: drawingStreak(days, today) };
		tx.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId,
				delta: DRAWING_STAR_VALUE,
				reason: DRAWING_STAR_REASON,
				refId: today,
				note: 'Drew the daily prompt',
				status: 'approved',
				createdAt: now
			})
			.run();
		return { awarded: true, streak: drawingStreak([...days, today], today) };
	});
}

/** Streak and "earned today" for every child, plus whether stars are on. */
export function drawingStarSummary(db: Db, now = Date.now()) {
	const today = localDate(now, householdTimeZone(db));
	const streaks: Record<string, StarInfo> = {};
	for (const m of db.select().from(members).where(eq(members.role, 'child')).all()) {
		const days = earnedDays(db, m.id);
		streaks[m.id] = { streak: drawingStreak(days, today), earned: days.includes(today) };
	}
	return { enabled: drawingStarsEnabled(db), date: today, streaks };
}

export const GAME_STARS_KEY = 'drawing.gameStars';

/** Stars for the draw-and-guess game (hub-t27j.25); on unless a grown-up turns it off. */
export const gameStarsEnabled = (db: Db): boolean => flag(db, GAME_STARS_KEY);

export function setGameStarsEnabled(db: Db, enabled: boolean): void {
	const value = JSON.stringify(enabled);
	db.insert(settings)
		.values({ key: GAME_STARS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

/**
 * Awards one star for a solved guess round to a child. `refId` names the round, so a repeat for
 * the same round never pays twice. Adults, unknown members and the off setting earn nothing.
 */
export function awardGameStar(db: Db, memberId: string, refId: string, now = Date.now()): boolean {
	return db.transaction((tx) => {
		const member = tx.select().from(members).where(eq(members.id, memberId)).get();
		if (!member || member.role !== 'child' || !gameStarsEnabled(db)) return false;
		const done = tx
			.select({ id: starTransactions.id })
			.from(starTransactions)
			.where(
				and(
					eq(starTransactions.memberId, memberId),
					eq(starTransactions.reason, DRAWING_STAR_REASON),
					eq(starTransactions.refId, refId)
				)
			)
			.get();
		if (done) return false;
		tx.insert(starTransactions)
			.values({
				id: randomUUID(),
				memberId,
				delta: DRAWING_STAR_VALUE,
				reason: DRAWING_STAR_REASON,
				refId,
				note: 'Solved a draw and guess round',
				status: 'approved',
				createdAt: now
			})
			.run();
		return true;
	});
}
