/**
 * Weekly chore summary for parents (requirement CHO-15). Read-only.
 *
 * - A week is Monday to Sunday, as calendar days in the household time zone. Star rows are
 *   placed on a day by their `createdAt` in that zone, so a DST week needs no special care.
 * - Stars: `earned` is every positive approved chore, bonus, streak or adjustment row; `spent` is
 *   redemptions; `removed` is negative approved chore, bonus, streak or adjustment rows.
 *   `net = earned - spent - removed`. Pending and rejected rows never count.
 * - Due chores come from the same schedule logic as the chore screens (`isDueOn`), using today's
 *   chore definitions and skipping archived chores (as streaks do).
 * - A chore is `done` when it has an approved completion that day, `pending` when only a
 *   completion awaiting approval exists, and `missed` when the day is over and neither exists.
 *   Today is never missed. A "this week so far" view counts days up to and including today.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, members, starTransactions } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { addDays } from '#lib/domain/streaks.js';
import { isDueOn, localDateIn, parseSchedule, type Schedule } from './chores.js';
import { LedgerError } from './ledger.js';
import { streakFor } from './streaks.js';

export interface SummaryChore {
	id: string;
	title: string;
	memberIds: string[];
	schedule: Schedule;
}
export interface SummaryCompletion {
	choreId: string;
	memberId: string;
	date: string;
	status: string;
}
export interface SummaryStar {
	memberId: string;
	delta: number;
	reason: string;
	createdAt: number;
}
export interface SummaryChild {
	id: string;
	name: string;
	color: string;
	avatar: string | null;
}

export interface MissedChore {
	date: string;
	choreId: string;
	title: string;
}
export interface ChildSummary {
	memberId: string;
	name: string;
	color: string;
	avatar: string | null;
	earned: number;
	spent: number;
	removed: number;
	net: number;
	/** Balance at the end of the counted days. */
	balance: number;
	due: number;
	done: number;
	pending: number;
	missed: MissedChore[];
	/** Streak (complete days in a row) as of the last counted day. */
	streak: number;
	/** The day with the most stars earned, or null when none were. */
	bestDay: { date: string; stars: number } | null;
}
export interface Totals {
	earned: number;
	spent: number;
	removed: number;
	net: number;
	due: number;
	done: number;
	missed: number;
}
export interface WeeklySummary {
	start: string;
	end: string;
	/** Last day counted: `end` for a finished week, today for the current one. */
	through: string;
	partial: boolean;
	prev: string;
	/** Start of the following week, or null when that week has not begun. */
	next: string | null;
	children: ChildSummary[];
	family: Totals;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The Monday on or before a YYYY-MM-DD day. */
export function weekStartOf(date: string): string {
	const real =
		DATE_RE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
	if (!real) throw new LedgerError('invalid', 'week must be a real YYYY-MM-DD date');
	const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
	return addDays(date, -((dow + 6) % 7));
}

export function buildWeeklySummary(input: {
	/** Any day in the wanted week; omitted means the last complete week. */
	week?: string;
	today: string;
	timeZone: string;
	children: SummaryChild[];
	chores: SummaryChore[];
	completions: SummaryCompletion[];
	stars: SummaryStar[];
	streakOf: (memberId: string, through: string) => number;
}): WeeklySummary {
	const { today, timeZone } = input;
	const thisWeek = weekStartOf(today);
	const start = input.week === undefined ? addDays(thisWeek, -7) : weekStartOf(input.week);
	if (start > thisWeek) throw new LedgerError('invalid', 'That week has not started yet');
	const end = addDays(start, 6);
	const through = end < today ? end : today;
	const partial = through < end;
	const days: string[] = [];
	for (let d = start; d <= through; d = addDays(d, 1)) days.push(d);

	const children = input.children.map((child): ChildSummary => {
		let earned = 0;
		let spent = 0;
		let removed = 0;
		let balance = 0;
		const perDay = new Map<string, number>();
		for (const s of input.stars) {
			if (s.memberId !== child.id) continue;
			const day = localDateIn(s.createdAt, timeZone);
			if (day <= through) balance += s.delta;
			if (day < start || day > through) continue;
			if (s.reason === 'redemption') spent -= s.delta;
			else if (s.delta > 0) {
				earned += s.delta;
				perDay.set(day, (perDay.get(day) ?? 0) + s.delta);
			} else removed -= s.delta;
		}
		let bestDay: ChildSummary['bestDay'] = null;
		for (const [date, stars] of perDay)
			if (!bestDay || stars > bestDay.stars || (stars === bestDay.stars && date < bestDay.date))
				bestDay = { date, stars };

		const seen = new Map<string, string>();
		for (const c of input.completions) {
			if (c.memberId !== child.id || (c.status !== 'approved' && c.status !== 'pending')) continue;
			const key = `${c.date}|${c.choreId}`;
			if (seen.get(key) !== 'approved') seen.set(key, c.status);
		}
		let due = 0;
		let done = 0;
		let pending = 0;
		const missed: MissedChore[] = [];
		for (const date of days) {
			for (const chore of input.chores) {
				if (!chore.memberIds.includes(child.id) || !isDueOn(chore.schedule, date)) continue;
				due += 1;
				const state = seen.get(`${date}|${chore.id}`);
				if (state === 'approved') done += 1;
				else if (state === 'pending') pending += 1;
				else if (date < today) missed.push({ date, choreId: chore.id, title: chore.title });
			}
		}
		missed.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
		return {
			memberId: child.id,
			name: child.name,
			color: child.color,
			avatar: child.avatar,
			earned,
			spent,
			removed,
			net: earned - spent - removed,
			balance,
			due,
			done,
			pending,
			missed,
			streak: input.streakOf(child.id, through),
			bestDay
		};
	});

	const sum = (f: (c: ChildSummary) => number) => children.reduce((n, c) => n + f(c), 0);
	const nextStart = addDays(start, 7);
	return {
		start,
		end,
		through,
		partial,
		prev: addDays(start, -7),
		next: nextStart <= today ? nextStart : null,
		children,
		family: {
			earned: sum((c) => c.earned),
			spent: sum((c) => c.spent),
			removed: sum((c) => c.removed),
			net: sum((c) => c.net),
			due: sum((c) => c.due),
			done: sum((c) => c.done),
			missed: sum((c) => c.missed.length)
		}
	};
}

/** Reads the database and builds the summary. `week` is any day in the wanted week. */
export function weeklySummary(
	db: Db,
	opts: { week?: string; now?: number; timeZone?: string } = {}
): WeeklySummary {
	const timeZone = opts.timeZone ?? householdTimeZone(db);
	const today = localDateIn(opts.now ?? Date.now(), timeZone);
	return buildWeeklySummary({
		week: opts.week,
		today,
		timeZone,
		children: db
			.select()
			.from(members)
			.where(eq(members.role, 'child'))
			.orderBy(members.createdAt, members.name)
			.all(),
		chores: db
			.select()
			.from(chores)
			.where(eq(chores.archived, false))
			.all()
			.map((c) => ({
				id: c.id,
				title: c.title,
				memberIds: JSON.parse(c.memberIds) as string[],
				schedule: parseSchedule(c.schedule, today)
			})),
		completions: db.select().from(choreCompletions).all(),
		stars: db.select().from(starTransactions).where(eq(starTransactions.status, 'approved')).all(),
		streakOf: (memberId, through) => streakFor(db, memberId, through).days
	});
}
