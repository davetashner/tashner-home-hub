/**
 * Daily habits star and weekly tally (hub-esf.4). The rules live in `#lib/domain/habits.js`;
 * this module counts a member's due and done habits from chores, completions and routines, and
 * keeps one `habits_day` ledger row per member per day in step with them.
 *
 * Each picture routine counts as one habit, due every day from the day it was made, and done
 * once all its steps are. Unchecking a habit the same day withdraws the star (the row is kept,
 * rejected, for audit); finishing again restores it, so a day can never pay twice.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, routines, starTransactions } from '../db/schema.js';
import {
	HABIT_DAY_STARS,
	dayComplete,
	habitDayRef,
	tally,
	weekSoFar,
	type HabitDay
} from '#lib/domain/habits.js';
import { householdTimeZone } from '../household.js';
import { isDueOn, localDateIn, parseSchedule } from './chores.js';
import { listRoutines } from './routines.js';

/** Habits due for a member on a day, and how many are done. */
export function habitDay(db: Db, memberId: string, date: string): HabitDay {
	const habits = db
		.select()
		.from(chores)
		.where(and(eq(chores.kind, 'habit'), eq(chores.archived, false)))
		.all()
		.filter(
			(c) =>
				(JSON.parse(c.memberIds) as string[]).includes(memberId) &&
				isDueOn(parseSchedule(c.schedule, date), date)
		);
	const done = new Set(
		habits.length === 0
			? []
			: db
					.select({ choreId: choreCompletions.choreId })
					.from(choreCompletions)
					.where(
						and(
							eq(choreCompletions.memberId, memberId),
							eq(choreCompletions.date, date),
							eq(choreCompletions.status, 'approved'),
							inArray(
								choreCompletions.choreId,
								habits.map((h) => h.id)
							)
						)
					)
					.all()
					.map((c) => c.choreId)
	);

	const zone = householdTimeZone(db);
	const made = new Map(
		db
			.select({ id: routines.id, createdAt: routines.createdAt })
			.from(routines)
			.where(eq(routines.memberId, memberId))
			.all()
			.map((r) => [r.id, localDateIn(r.createdAt, zone)])
	);
	const mine = listRoutines(db, { memberId, date }).filter(
		(r) => r.steps.length > 0 && (made.get(r.id) ?? date) <= date
	);
	return {
		due: habits.length + mine.length,
		done: done.size + mine.filter((r) => r.done >= r.steps.length).length
	};
}

/**
 * Brings the member's star for `date` in line with their habits: awards it when every habit is
 * done, withdraws it when one is unchecked. Returns whether the star now counts.
 */
export function settleHabitStar(db: Db, memberId: string, date: string, now: number): boolean {
	const complete = dayComplete(habitDay(db, memberId, date));
	const refId = habitDayRef(memberId, date);
	const row = db
		.select()
		.from(starTransactions)
		.where(and(eq(starTransactions.reason, 'habits_day'), eq(starTransactions.refId, refId)))
		.get();
	const status = complete ? 'approved' : 'rejected';
	if (!row) {
		if (complete)
			db.insert(starTransactions)
				.values({
					id: randomUUID(),
					memberId,
					delta: HABIT_DAY_STARS,
					reason: 'habits_day',
					refId,
					note: 'All habits done',
					status,
					createdAt: now
				})
				.run();
	} else if (row.status !== status) {
		db.update(starTransactions).set({ status }).where(eq(starTransactions.id, row.id)).run();
	}
	return complete;
}

export interface HabitSummary {
	today: HabitDay;
	/** Monday to today. */
	week: HabitDay;
	/** Whether today's habit star is earned. */
	starEarned: boolean;
}

/** Today's habit counter, the week's tally so far, and whether today's star is in. */
export function habitSummary(db: Db, memberId: string, today: string): HabitSummary {
	const days = weekSoFar(today).map((d) => habitDay(db, memberId, d));
	const todayDay = days.at(-1)!;
	return { today: todayDay, week: tally(days), starEarned: dayComplete(todayDay) };
}
