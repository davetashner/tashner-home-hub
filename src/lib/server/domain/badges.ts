/**
 * Badge facts and the sticker book (requirement CHO-14). The rules live in `#lib/domain/badges.js`;
 * this module reads the ledger and history. Nothing is stored: badges are derived on every read.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, redemptions, starTransactions } from '../db/schema.js';
import {
	bestWeekCount,
	longestRun,
	paidStreakDays,
	stickerBook,
	type BadgeFacts,
	type Sticker
} from '#lib/domain/badges.js';
import { MAX_STREAK_DAYS, addDays, dayOutcome, type DayOutcome } from '#lib/domain/streaks.js';
import { isVacationDay } from '#lib/domain/vacation.js';
import { householdTimeZone } from '../household.js';
import { isDueOn, localDateIn, parseSchedule } from './chores.js';
import { readVacation } from './vacation.js';

/** The longest habit streak in the last year of history, or ever paid out as a milestone. */
function longestStreak(db: Db, memberId: string, today: string, refs: (string | null)[]): number {
	const mine = db
		.select()
		.from(chores)
		.where(and(eq(chores.archived, false), eq(chores.kind, 'habit')))
		.all()
		.filter((c) => (JSON.parse(c.memberIds) as string[]).includes(memberId))
		.map((c) => ({ id: c.id, schedule: parseSchedule(c.schedule, today) }));
	const from = addDays(today, -MAX_STREAK_DAYS);
	const rows = db
		.select()
		.from(choreCompletions)
		.where(and(eq(choreCompletions.memberId, memberId), eq(choreCompletions.status, 'approved')))
		.all()
		.filter((c) => c.date >= from && c.date <= today);
	const approved = new Set(rows.map((c) => `${c.date}|${c.choreId}`));
	// Judging a day expands every habit's schedule, so start at the first finished habit, not a year back.
	const first = rows.reduce<string | null>((m, c) => (m === null || c.date < m ? c.date : m), null);
	if (first === null) return paidStreakDays(refs);
	const vacation = readVacation(db);
	const outcomes: DayOutcome[] = [];
	for (let date = first; date <= today; date = addDays(date, 1)) {
		if (isVacationDay(vacation, date)) {
			outcomes.push('none');
			continue;
		}
		const due = mine.filter((c) => isDueOn(c.schedule, date));
		const outcome = dayOutcome(
			due.length,
			due.filter((c) => approved.has(`${date}|${c.id}`)).length
		);
		// Today is still open: it never breaks a run.
		outcomes.push(date === today && outcome === 'missed' ? 'none' : outcome);
	}
	return Math.max(longestRun(outcomes), paidStreakDays(refs));
}

export function badgeFacts(db: Db, memberId: string, today: string): BadgeFacts {
	const done = db
		.select({ kind: chores.kind, date: choreCompletions.date })
		.from(choreCompletions)
		.innerJoin(chores, eq(chores.id, choreCompletions.choreId))
		.where(and(eq(choreCompletions.memberId, memberId), eq(choreCompletions.status, 'approved')))
		.all();
	const ledger = db
		.select({
			delta: starTransactions.delta,
			reason: starTransactions.reason,
			refId: starTransactions.refId
		})
		.from(starTransactions)
		.where(and(eq(starTransactions.memberId, memberId), eq(starTransactions.status, 'approved')))
		.all();
	return {
		starJobsDone: done.filter((d) => d.kind === 'star_job').length,
		// Earned, not net: gains only, never a grown-up's correction, never minus spending.
		lifetimeStars: ledger
			.filter((r) => r.delta > 0 && r.reason !== 'adjustment')
			.reduce((sum, r) => sum + r.delta, 0),
		longestStreak: longestStreak(
			db,
			memberId,
			today,
			ledger.filter((r) => r.reason === 'streak').map((r) => r.refId)
		),
		redemptions: db
			.select({ id: redemptions.id })
			.from(redemptions)
			.where(eq(redemptions.memberId, memberId))
			.all().length,
		bestHabitWeek: bestWeekCount(done.filter((d) => d.kind === 'habit').map((d) => d.date))
	};
}

/** A child's sticker book: every badge, earned or not. Read-only. */
export function stickerBookFor(
	db: Db,
	memberId: string,
	clock: { now?: number; timeZone?: string } = {}
): Sticker[] {
	const today = localDateIn(clock.now ?? Date.now(), clock.timeZone ?? householdTimeZone(db));
	return stickerBook(badgeFacts(db, memberId, today));
}
