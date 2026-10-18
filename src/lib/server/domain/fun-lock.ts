/**
 * "Finish your jobs first" (hub-ruz): after a kid misses a job, Games and Music wait until all of
 * today's Star Jobs are done, or a grown-up unlocks them for the day (logged in `fun_unlocks`).
 *
 * A miss is "recent" when its period ended yesterday or it was judged today (catch-up after
 * downtime). Habits never count, and neither do any-day to-dos (they are not due on a day). A kid
 * with no Star Jobs due today is not held back: there is nothing to finish.
 */
import { and, eq, gte, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { addDays } from '#lib/domain/streaks.js';
import type { Db } from '../db/index.js';
import { chores, funUnlocks, members, missedJudgments } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { choresForDay, localDateIn } from './chores.js';
import { LedgerError } from './ledger.js';

export interface FunLockStatus {
	memberId: string;
	locked: boolean;
	/** Jobs still to finish today (only filled while locked). */
	remaining: { id: string; title: string; icon: string | null }[];
	/** Titles of the recent misses, so the lock can say why. */
	missed: string[];
	unlockedToday: boolean;
}

export function funLockStatus(
	db: Db,
	memberId: string,
	now: number = Date.now(),
	timeZone: string = householdTimeZone(db)
): FunLockStatus {
	const today = localDateIn(now, timeZone);
	const yesterday = addDays(today, -1);
	const recent = db
		.select({
			title: chores.title,
			periodEnd: missedJudgments.periodEnd,
			judgedAt: missedJudgments.judgedAt
		})
		.from(missedJudgments)
		.innerJoin(chores, eq(chores.id, missedJudgments.choreId))
		.where(
			and(
				eq(missedJudgments.memberId, memberId),
				eq(missedJudgments.missed, true),
				// Old rows can never be recent: keep the scan small however long the history grows.
				or(
					gte(missedJudgments.periodEnd, yesterday),
					gte(missedJudgments.judgedAt, now - 2 * 86_400_000)
				)
			)
		)
		.all()
		.filter((r) => r.periodEnd >= yesterday || localDateIn(r.judgedAt, timeZone) === today);
	const none = { memberId, locked: false, remaining: [], missed: [], unlockedToday: false };
	if (recent.length === 0) return none;
	const unlockedToday =
		db
			.select()
			.from(funUnlocks)
			.where(and(eq(funUnlocks.memberId, memberId), eq(funUnlocks.day, today)))
			.get() !== undefined;
	const remaining = choresForDay(db, memberId, today, timeZone)
		.filter((g) => g.timeOfDay !== 'week')
		.flatMap((g) => g.chores)
		.filter(
			(c) =>
				c.kind === 'star_job' &&
				(c.status === 'none' || c.status === 'undone' || c.status === 'rejected')
		)
		.map((c) => ({ id: c.id, title: c.title, icon: c.icon }));
	return {
		memberId,
		locked: !unlockedToday && remaining.length > 0,
		remaining: unlockedToday ? [] : remaining,
		missed: [...new Set(recent.map((r) => r.title))],
		unlockedToday
	};
}

/**
 * Every child's status, for the Games and Music tabs. Judging is the scheduler's job (plus a
 * throttled catch-up in the routes), so reading a status stays cheap.
 */
export function funLocks(db: Db, now: number = Date.now(), timeZone?: string): FunLockStatus[] {
	const zone = timeZone ?? householdTimeZone(db);
	return db
		.select({ id: members.id })
		.from(members)
		.where(eq(members.role, 'child'))
		.all()
		.map((m) => funLockStatus(db, m.id, now, zone));
}

/** A grown-up lets a kid into Games and Music for the rest of today. Logged: who and when. */
export function unlockFun(
	db: Db,
	input: { memberId: string; by: { id: string; name: string }; now?: number; timeZone?: string }
): FunLockStatus {
	const now = input.now ?? Date.now();
	const zone = input.timeZone ?? householdTimeZone(db);
	const kid = db.select().from(members).where(eq(members.id, input.memberId)).get();
	if (!kid || kid.role !== 'child') throw new LedgerError('not_found', 'Child not found');
	db.insert(funUnlocks)
		.values({
			id: randomUUID(),
			memberId: kid.id,
			day: localDateIn(now, zone),
			unlockedBy: input.by.id,
			unlockedByName: input.by.name,
			unlockedAt: now
		})
		.run();
	return funLockStatus(db, kid.id, now, zone);
}
