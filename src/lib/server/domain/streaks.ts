/**
 * Streak data + milestone payouts (requirement CHO-10). The rules live in
 * `#lib/domain/streaks.js`; this module reads chores/completions and writes `streak` ledger rows.
 *
 * Only habits are judged: Star Jobs never affect a streak. Judging history uses today's chore definitions: a chore added or rescheduled later does not
 * count before its schedule start, but edits to who it is assigned to apply to past days too.
 * Stars already paid are never taken back if a completion is undone later.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, members, settings, starTransactions } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import {
	STREAK_SETTINGS_KEY,
	MAX_STREAK_DAYS,
	addDays,
	computeStreak,
	dayOutcome,
	milestonesToAward,
	nextMilestone,
	parseMilestones,
	streakRef,
	type Milestone
} from '#lib/domain/streaks.js';
import { isVacationDay } from '#lib/domain/vacation.js';
import { isDueOn, localDateIn, parseSchedule } from './chores.js';
import { readVacation } from './vacation.js';

export interface StreakSummary {
	days: number;
	next: Milestone | null;
	milestones: Milestone[];
}

export function streakMilestones(db: Db): Milestone[] {
	const row = db.select().from(settings).where(eq(settings.key, STREAK_SETTINGS_KEY)).get();
	let raw: unknown = null;
	try {
		raw = row ? JSON.parse(row.value) : null;
	} catch {
		// corrupt value: defaults
	}
	return parseMilestones(raw);
}

export function streakFor(db: Db, memberId: string, today: string) {
	const mine = db
		.select()
		.from(chores)
		.where(and(eq(chores.archived, false), eq(chores.kind, 'habit')))
		.all()
		.filter((c) => (JSON.parse(c.memberIds) as string[]).includes(memberId))
		.map((c) => ({ id: c.id, schedule: parseSchedule(c.schedule, today) }));
	const from = addDays(today, -MAX_STREAK_DAYS);
	const approved = new Set(
		db
			.select()
			.from(choreCompletions)
			.where(and(eq(choreCompletions.memberId, memberId), eq(choreCompletions.status, 'approved')))
			.all()
			.filter((c) => c.date >= from && c.date <= today)
			.map((c) => `${c.date}|${c.choreId}`)
	);
	const vacation = readVacation(db);
	return computeStreak((date) => {
		// Vacation days are skipped: nothing is due, so they neither extend nor break a run.
		if (isVacationDay(vacation, date)) return 'none';
		const due = mine.filter((c) => isDueOn(c.schedule, date));
		return dayOutcome(due.length, due.filter((c) => approved.has(`${date}|${c.id}`)).length);
	}, today);
}

/** Current streak and the next milestone for a child. Read-only. */
export function streakSummary(
	db: Db,
	memberId: string,
	clock: { now?: number; timeZone?: string } = {}
): StreakSummary {
	const today = localDateIn(clock.now ?? Date.now(), clock.timeZone ?? householdTimeZone(db));
	const milestones = streakMilestones(db);
	const { days } = streakFor(db, memberId, today);
	return { days, next: nextMilestone(days, milestones), milestones };
}

/**
 * Pays any milestone the child's streak has reached and not yet been paid for. Safe to call after
 * every approval: payouts are keyed by milestone and run start, so repeats add nothing.
 */
export function awardStreakMilestones(
	db: Db,
	memberId: string,
	clock: { now?: number; timeZone?: string } = {}
): Milestone[] {
	const now = clock.now ?? Date.now();
	const today = localDateIn(now, clock.timeZone ?? householdTimeZone(db));
	return db.transaction((tx) => {
		if (!tx.select().from(members).where(eq(members.id, memberId)).get()) return [];
		const streak = streakFor(tx as unknown as Db, memberId, today);
		const paid = tx
			.select({ refId: starTransactions.refId })
			.from(starTransactions)
			.where(and(eq(starTransactions.memberId, memberId), eq(starTransactions.reason, 'streak')))
			.all()
			.map((r) => r.refId);
		const owed = milestonesToAward(streak, streakMilestones(tx as unknown as Db), paid);
		for (const m of owed) {
			tx.insert(starTransactions)
				.values({
					id: randomUUID(),
					memberId,
					delta: m.stars,
					reason: 'streak',
					refId: streakRef(m.days, streak.runStart as string),
					note: `${m.days}-day habit streak`,
					status: 'approved',
					createdAt: now
				})
				.run();
		}
		return owed;
	});
}

/** Pays milestones for the child who owns a completion (after approve, or auto-approved taps). */
export function awardForCompletion(db: Db, completionId: string, clock = {}): Milestone[] {
	const c = db
		.select({ memberId: choreCompletions.memberId, status: choreCompletions.status })
		.from(choreCompletions)
		.where(
			and(eq(choreCompletions.id, completionId), inArray(choreCompletions.status, ['approved']))
		)
		.get();
	return c ? awardStreakMilestones(db, c.memberId, clock) : [];
}
