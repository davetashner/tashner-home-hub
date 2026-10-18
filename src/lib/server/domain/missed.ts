/**
 * Consequences for missed jobs (hub-ruz). When a kid's Star Job period ends undone (a daily job:
 * its day; a flexible to-do: its Monday-to-Sunday period), the stars it would have earned come off
 * the ledger as `Missed: <job>`, never taking the balance below zero.
 *
 * Choices (kid-friendly where the spec is silent):
 * - Habits are exempt. Archived jobs and jobs not assigned to the kid are never judged.
 * - A job counts only for periods after the day it was created (a flexible one: periods that start
 *   on or after it), and only periods that ended on or after the day the feature first ran, within
 *   the last 14 days, so turning this on never punishes history.
 * - Any completion except an undone one counts as done: pending approval is not missed, and a
 *   grown-up's rejection is not charged a second time.
 * - Every judged period is recorded once (unique on job, kid, period), so a restart, a second tab
 *   or the catch-up after downtime never deducts twice.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { addDays } from '#lib/domain/streaks.js';
import type { Db } from '../db/index.js';
import {
	choreCompletions,
	chores,
	members,
	missedJudgments,
	settings,
	starTransactions
} from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import rrulePkg from 'rrule';
import type { RRule } from 'rrule';
import { localDateIn, parseSchedule, scheduleToRRule } from './chores.js';
import { flexPeriod } from './flex.js';

/** How far back one run looks, so a long outage cannot cause a pile of deductions. */
export const MISSED_LOOKBACK_DAYS = 14;
export const MISSED_SINCE_KEY = 'missed_jobs_since';

export interface MissedJob {
	choreId: string;
	memberId: string;
	title: string;
	periodKey: string;
	periodEnd: string;
	/** Stars taken off the ledger (may be less than the job's worth, or 0). */
	starsRemoved: number;
}

export const missedLabel = (title: string) => `Missed: ${title}`;

/** The day the feature first ran: nothing that ended before it is ever judged. */
function sinceDay(db: Db, today: string): string {
	const row = db.select().from(settings).where(eq(settings.key, MISSED_SINCE_KEY)).get();
	if (row) {
		try {
			const v: unknown = JSON.parse(row.value);
			if (typeof v === 'string') return v;
		} catch {
			// corrupt: restart the baseline from today
		}
	}
	db.insert(settings)
		.values({ key: MISSED_SINCE_KEY, value: JSON.stringify(today) })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: JSON.stringify(today), updatedAt: Date.now() }
		})
		.run();
	return today;
}

interface Period {
	key: string;
	start: string;
	end: string;
}

/** Periods of a job that ended before `today` and on or after `from` (and were open after creation). */
function endedPeriods(
	row: typeof chores.$inferSelect,
	created: string,
	from: string,
	today: string
): Period[] {
	const schedule = parseSchedule(row.schedule, created);
	const out: Period[] = [];
	if (schedule.type === 'flex') {
		let d = from < schedule.start ? schedule.start : from;
		while (d < today) {
			const p = flexPeriod(schedule.start, schedule.every, d);
			if (!p) break;
			if (p.end < today && p.end >= from && p.start >= created)
				out.push({ key: `flex:${p.start}`, start: p.start, end: p.end });
			d = addDays(p.end, 1);
		}
		return out;
	}
	// One recurrence expansion for the whole window (parsing a rule per day is far too slow).
	const rule = rrulePkg.rrulestr(scheduleToRRule(schedule)) as RRule;
	const first = new Date(`${from}T00:00:00Z`);
	const last = new Date(`${addDays(today, -1)}T23:59:59.999Z`);
	for (const hit of rule.between(first, last, true)) {
		const d = hit.toISOString().slice(0, 10);
		if (d > created && d >= schedule.start) out.push({ key: d, start: d, end: d });
	}
	return out;
}

/**
 * Judges every period that has ended and not been judged yet; returns the ones missed. Safe to call
 * as often as you like, from any number of places.
 */
export function judgeMissedPeriods(
	db: Db,
	now: number = Date.now(),
	timeZone: string = householdTimeZone(db)
): MissedJob[] {
	const today = localDateIn(now, timeZone);
	const since = sinceDay(db, today);
	const lookback = addDays(today, -MISSED_LOOKBACK_DAYS);
	const from = since > lookback ? since : lookback;
	if (from >= today) return [];

	const kids = new Set(
		db
			.select({ id: members.id })
			.from(members)
			.where(eq(members.role, 'child'))
			.all()
			.map((m) => m.id)
	);
	const jobs = db
		.select()
		.from(chores)
		.where(and(eq(chores.archived, false), eq(chores.kind, 'star_job')))
		.all();
	if (jobs.length === 0 || kids.size === 0) return [];

	const done = db
		.select()
		.from(choreCompletions)
		.where(
			and(
				gte(choreCompletions.date, addDays(from, -13)),
				lte(choreCompletions.date, today),
				inArray(choreCompletions.status, ['pending', 'approved', 'rejected'])
			)
		)
		.all();
	const judged = new Set<string>();
	/** Latest judged period end per job and kid: a job judged through yesterday needs no scan. */
	const through = new Map<string, string>();
	for (const j of db
		.select()
		.from(missedJudgments)
		.where(gte(missedJudgments.periodEnd, from))
		.all()) {
		judged.add(`${j.choreId}|${j.memberId}|${j.periodKey}`);
		const k = `${j.choreId}|${j.memberId}`;
		if ((through.get(k) ?? '') < j.periodEnd) through.set(k, j.periodEnd);
	}
	const yesterday = addDays(today, -1);

	const todo: { job: typeof chores.$inferSelect; memberId: string; period: Period }[] = [];
	for (const job of jobs) {
		const assigned = (JSON.parse(job.memberIds) as string[]).filter((m) => kids.has(m));
		if (assigned.length === 0) continue;
		if (assigned.every((m) => (through.get(`${job.id}|${m}`) ?? '') >= yesterday)) continue;
		const created = localDateIn(job.createdAt, timeZone);
		const periods = endedPeriods(job, created, from, today);
		if (periods.length === 0) continue;
		for (const memberId of assigned) {
			for (const period of periods) {
				if (judged.has(`${job.id}|${memberId}|${period.key}`)) continue;
				todo.push({ job, memberId, period });
			}
		}
	}
	todo.sort((a, b) => a.period.end.localeCompare(b.period.end));

	const missed: MissedJob[] = [];
	for (const { job, memberId, period } of todo) {
		const finished = done.some(
			(c) =>
				c.choreId === job.id &&
				c.memberId === memberId &&
				c.date >= period.start &&
				c.date <= period.end
		);
		const result = db.transaction((tx) => {
			const id = randomUUID();
			let removed = 0;
			if (!finished) {
				const balance = tx
					.select({
						total: sql<number>`coalesce(sum(${starTransactions.delta}), 0)`
					})
					.from(starTransactions)
					.where(
						and(eq(starTransactions.memberId, memberId), eq(starTransactions.status, 'approved'))
					)
					.get() as { total: number };
				removed = Math.min(job.stars, Math.max(balance.total, 0));
			}
			const inserted = tx
				.insert(missedJudgments)
				.values({
					id,
					choreId: job.id,
					memberId,
					periodKey: period.key,
					periodEnd: period.end,
					missed: !finished,
					starsRemoved: removed,
					judgedAt: now
				})
				.onConflictDoNothing()
				.returning({ id: missedJudgments.id })
				.get();
			if (!inserted) return null; // another run got here first
			if (removed > 0)
				tx.insert(starTransactions)
					.values({
						id: randomUUID(),
						memberId,
						delta: -removed,
						reason: 'adjustment',
						refId: id,
						note: missedLabel(job.title),
						status: 'approved',
						createdAt: now
					})
					.run();
			return removed;
		});
		if (result !== null && !finished)
			missed.push({
				choreId: job.id,
				memberId,
				title: job.title,
				periodKey: period.key,
				periodEnd: period.end,
				starsRemoved: result
			});
	}
	return missed;
}
