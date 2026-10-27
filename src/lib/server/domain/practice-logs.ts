/**
 * Reading and practice logs (hub-kko.2). A kid logs their own minutes with no approval: the stars
 * land as approved ledger rows at once. Star math is in `#lib/domain/practice.js`; the day's stars
 * are always worked out from the day's active minutes, so splitting a session earns the same.
 */
import { randomUUID } from 'node:crypto';
import { and, between, desc, eq, sql } from 'drizzle-orm';
import { buildWeek, weekDates, type PracticeWeek } from '#lib/domain/practice-week.js';
import {
	MAX_LOG_MINUTES,
	minutesToNextStar,
	starsForLog,
	starsForMinutes,
	type PracticeRate
} from '#lib/domain/practice.js';
import type { Db } from '../db/index.js';
import { members, practiceActivities, practiceLogs, starTransactions } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { localDateIn } from './chores.js';
import { KID_UNDO_WINDOW_MS, LedgerError } from './ledger.js';
import { activitiesForMember, type PracticeActivity } from './practice-activities.js';

export type PracticeLog = typeof practiceLogs.$inferSelect;

export interface PracticeDaySummary {
	activityId: string;
	name: string;
	emoji: string | null;
	/** The activity's rate, so the kid screen can show stars before the server answers. */
	rate: PracticeRate;
	minutesToday: number;
	starsToday: number;
	/** Minutes until the next star, or null once the daily cap is reached. */
	minutesToNextStar: number | null;
	capReached: boolean;
	/** The newest active log today, which a kid may still undo; null when none. */
	lastLog: { id: string; minutes: number; stars: number; createdAt: number } | null;
}

function minutesOn(db: Db, memberId: string, activityId: string, date: string): number {
	return db
		.select({ minutes: practiceLogs.minutes })
		.from(practiceLogs)
		.where(
			and(
				eq(practiceLogs.memberId, memberId),
				eq(practiceLogs.activityId, activityId),
				eq(practiceLogs.date, date),
				eq(practiceLogs.status, 'active')
			)
		)
		.all()
		.reduce((sum, l) => sum + l.minutes, 0);
}

function lastActive(db: Db, memberId: string, activityId: string, date: string) {
	return db
		.select()
		.from(practiceLogs)
		.where(
			and(
				eq(practiceLogs.memberId, memberId),
				eq(practiceLogs.activityId, activityId),
				eq(practiceLogs.date, date),
				eq(practiceLogs.status, 'active')
			)
		)
		.orderBy(desc(practiceLogs.createdAt), desc(sql`rowid`))
		.get();
}

/** Logs `minutes` for the kid and awards the new stars, in one transaction. */
export function logPractice(
	db: Db,
	input: { memberId: string; activityId: string; minutes: number; now: number }
): { log: PracticeLog; stars: number; summary: PracticeDaySummary } {
	const { memberId, activityId, minutes, now } = input;
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LOG_MINUTES)
		throw new LedgerError('invalid', `minutes must be a whole number from 1 to ${MAX_LOG_MINUTES}`);
	const date = localDateIn(now, householdTimeZone(db));
	return db.transaction((tx) => {
		const member = tx.select().from(members).where(eq(members.id, memberId)).get();
		if (!member) throw new LedgerError('not_found', 'Member not found');
		if (member.role !== 'child')
			throw new LedgerError('forbidden', 'Only kids log reading and practice');
		const activity = tx
			.select()
			.from(practiceActivities)
			.where(eq(practiceActivities.id, activityId))
			.get();
		if (!activity) throw new LedgerError('not_found', 'Activity not found');
		if (!activitiesForMember(db, memberId).some((a) => a.id === activityId))
			throw new LedgerError('forbidden', 'That activity is not available');
		const before = minutesOn(db, memberId, activityId, date);
		if (before + minutes > MAX_LOG_MINUTES)
			throw new LedgerError('invalid', `A day holds at most ${MAX_LOG_MINUTES} minutes`);
		const stars = starsForLog(activity, before, minutes);
		const logId = randomUUID();
		let starTxId: string | null = null;
		if (stars > 0) {
			starTxId = randomUUID();
			tx.insert(starTransactions)
				.values({
					id: starTxId,
					memberId,
					delta: stars,
					reason: 'practice',
					refId: logId,
					note: `${activity.name} ${minutes} min`,
					status: 'approved',
					createdAt: now
				})
				.run();
		}
		const log = tx
			.insert(practiceLogs)
			.values({ id: logId, memberId, activityId, minutes, date, stars, starTxId, createdAt: now })
			.returning()
			.get();
		return { log, stars, summary: summaryFor(db, activity, memberId, date) };
	});
}

/**
 * Takes a log back: the log is marked undone and its star row rejected (kept for audit). Kids have
 * the usual short window and only the day's newest log, so the day's stars stay consistent.
 */
export function undoPractice(
	db: Db,
	logId: string,
	opts: { memberId?: string; now: number; byAdult: boolean }
): { log: PracticeLog; summary: PracticeDaySummary } {
	return db.transaction((tx) => {
		const log = tx.select().from(practiceLogs).where(eq(practiceLogs.id, logId)).get();
		if (!log || (opts.memberId !== undefined && log.memberId !== opts.memberId))
			throw new LedgerError('not_found', 'Log not found');
		if (log.status !== 'active') throw new LedgerError('conflict', 'Already taken back');
		if (!opts.byAdult && opts.now - log.createdAt > KID_UNDO_WINDOW_MS)
			throw new LedgerError('forbidden', 'Undo window has passed; ask a grown-up');
		if (lastActive(db, log.memberId, log.activityId, log.date)?.id !== log.id)
			throw new LedgerError('conflict', 'Only the latest log of the day can be taken back');
		const updated = tx
			.update(practiceLogs)
			.set({ status: 'undone' })
			.where(eq(practiceLogs.id, logId))
			.returning()
			.get();
		if (log.starTxId)
			tx.update(starTransactions)
				.set({ status: 'rejected' })
				.where(eq(starTransactions.id, log.starTxId))
				.run();
		const activity = tx
			.select()
			.from(practiceActivities)
			.where(eq(practiceActivities.id, log.activityId))
			.get()!;
		return { log: updated, summary: summaryFor(db, activity, log.memberId, log.date) };
	});
}

function summaryFor(
	db: Db,
	a: Pick<PracticeActivity, 'id' | 'name' | 'emoji'> & PracticeRate,
	memberId: string,
	date: string
): PracticeDaySummary {
	const minutes = minutesOn(db, memberId, a.id, date);
	const rate: PracticeRate = a;
	const last = lastActive(db, memberId, a.id, date);
	const next = minutesToNextStar(rate, minutes);
	return {
		activityId: a.id,
		name: a.name,
		emoji: a.emoji,
		rate: {
			minutesPerBlock: a.minutesPerBlock,
			starsPerBlock: a.starsPerBlock,
			dailyStarCap: a.dailyStarCap
		},
		minutesToday: minutes,
		starsToday: starsForMinutes(rate, minutes),
		minutesToNextStar: next,
		capReached: next === null,
		lastLog: last
			? { id: last.id, minutes: last.minutes, stars: last.stars, createdAt: last.createdAt }
			: null
	};
}

/** One summary per activity the kid can log today. */
export function practiceSummary(db: Db, memberId: string, now: number): PracticeDaySummary[] {
	const date = localDateIn(now, householdTimeZone(db));
	return activitiesForMember(db, memberId).map((a) => summaryFor(db, a, memberId, date));
}

export interface PracticeWeekView extends PracticeWeek {
	today: string;
	/** Name and emoji for every activity that appears in the week. */
	activityInfo: { activityId: string; name: string; emoji: string | null }[];
}

/** The kid's week of active logs (Monday to Sunday of the week holding `date`, default today). */
export function practiceWeek(
	db: Db,
	memberId: string,
	now: number,
	date?: string
): PracticeWeekView {
	const today = localDateIn(now, householdTimeZone(db));
	const dates = weekDates(date ?? today);
	const logs = db
		.select({
			date: practiceLogs.date,
			activityId: practiceLogs.activityId,
			minutes: practiceLogs.minutes,
			stars: practiceLogs.stars
		})
		.from(practiceLogs)
		.where(
			and(
				eq(practiceLogs.memberId, memberId),
				eq(practiceLogs.status, 'active'),
				between(practiceLogs.date, dates[0]!, dates[6]!)
			)
		)
		.all();
	const week = buildWeek(logs, dates[0]!, today);
	const names = db.select().from(practiceActivities).all();
	return {
		...week,
		today,
		activityInfo: week.activities.map((a) => {
			const n = names.find((x) => x.id === a.activityId);
			return { activityId: a.activityId, name: n?.name ?? 'Practice', emoji: n?.emoji ?? null };
		})
	};
}
