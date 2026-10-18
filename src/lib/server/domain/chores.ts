/**
 * Chore model + scheduling (requirements CHO-1, CHO-2; §3.4).
 *
 * Schedules are stored as RFC 5545 text (`DTSTART:...` + `RRULE:...`) via the `rrule`
 * package, but the API speaks a friendly {@link Schedule}. Chores are day-granular, so
 * every date is a "floating" calendar day anchored at 00:00 UTC. Recurrence therefore
 * never touches a local clock and cannot drift across a DST change; the time zone is only
 * used to decide what "today" is.
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { addDays } from '#lib/domain/streaks.js';
import rrulePkg from 'rrule';
import type { RRule } from 'rrule';
import type { Db } from '../db/index.js';
import { CHORE_KINDS, choreCompletions, chores, members } from '../db/schema.js';
import { householdTimeZone } from '../household.js';
import { FLEX_MARK, flexOf, flexPeriod, type FlexEvery } from './flex.js';
import { LedgerError, createChore as insertChore } from './ledger.js';

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Star Jobs earn stars; habits are everyday checks with no stars and no approval (hub-esf). */
export type ChoreKind = (typeof CHORE_KINDS)[number];

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Friendly schedule. `start` is the first local day (YYYY-MM-DD) and anchors weekly/monthly.
 * `flex` is once per week (or two), on any day: it has no due day of its own (see ./flex.ts).
 */
export type Schedule =
	| { type: 'once'; start: string }
	| { type: 'daily'; start: string }
	| { type: 'weekdays'; start: string; days: Weekday[] }
	| { type: 'weekly'; start: string }
	| { type: 'monthly'; start: string }
	| { type: 'flex'; start: string; every: FlexEvery };

export type CompletionState = 'none' | 'pending' | 'approved' | 'rejected' | 'undone';

export interface ChoreView {
	id: string;
	title: string;
	kind: ChoreKind;
	icon: string | null;
	memberIds: string[];
	stars: number;
	schedule: Schedule;
	timeOfDay: TimeOfDay;
	requiresApproval: boolean;
	archived: boolean;
}

export interface ChoreInput {
	title: string;
	/** Set on create only; a Star Job never turns into a habit or back. */
	kind?: ChoreKind;
	icon?: string | null;
	memberIds?: string[];
	stars?: number;
	schedule?: Partial<Schedule> & { type?: string };
	timeOfDay?: string;
	requiresApproval?: boolean;
}

export interface DueChore extends ChoreView {
	status: CompletionState;
	completionId: string | null;
	/** Flexible to-dos only: the last day of the period, and which of its weeks today is in. */
	flex?: { dueBy: string; week: number; weeks: FlexEvery };
}

/** Flexible to-dos open this period show in their own group, after the times of day. */
export type DueGroup = TimeOfDay | 'week';

export interface TimeGroup {
	timeOfDay: DueGroup;
	chores: DueChore[];
}

export interface Clock {
	now?: number;
	timeZone?: string;
}

const invalid = (message: string) => new LedgerError('invalid', message);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function validDate(value: unknown, name = 'date'): string {
	if (typeof value !== 'string' || !DATE_RE.test(value))
		throw invalid(`${name} must be YYYY-MM-DD`);
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
		throw invalid(`${name} is not a real date`);
	return value;
}

/** The local calendar day (YYYY-MM-DD) for an instant in an IANA time zone. */
export function localDateIn(now: number, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(now));
	} catch {
		throw invalid('Unknown time zone');
	}
}

function validTitle(value: unknown): string {
	const title = typeof value === 'string' ? value.trim() : '';
	if (title.length < 1 || title.length > 60) throw invalid('Title must be 1-60 characters');
	return title;
}

function validIcon(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') throw invalid('Icon must be a single emoji');
	const parts = [...segmenter.segment(value.trim())];
	if (parts.length !== 1 || !/\p{Extended_Pictographic}/u.test(value))
		throw invalid('Icon must be a single emoji');
	return parts[0].segment;
}

function validStars(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10)
		throw invalid('Stars must be a whole number from 1 to 10');
	return value;
}

function validKind(value: unknown): ChoreKind {
	if (!(CHORE_KINDS as readonly unknown[]).includes(value))
		throw invalid(`kind must be one of ${CHORE_KINDS.join(', ')}`);
	return value as ChoreKind;
}

function validTimeOfDay(value: unknown): TimeOfDay {
	if (!(TIMES_OF_DAY as readonly unknown[]).includes(value))
		throw invalid(`timeOfDay must be one of ${TIMES_OF_DAY.join(', ')}`);
	return value as TimeOfDay;
}

function validMembers(db: Db, value: unknown): string[] {
	if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
		throw invalid('memberIds must be a list of member ids');
	const ids = [...new Set(value as string[])];
	if (ids.length === 0) return ids;
	const found = db.select({ id: members.id }).from(members).where(inArray(members.id, ids)).all();
	if (found.length !== ids.length) throw invalid('Unknown member in memberIds');
	return ids;
}

// --- Schedule <-> RRULE ------------------------------------------------------------------

function anchor(start: string): Date {
	return new Date(`${start}T00:00:00Z`);
}

/** Validates a friendly schedule and returns it in canonical form. */
export function validSchedule(input: ChoreInput['schedule'], today: string): Schedule {
	const raw = input ?? { type: 'daily' };
	const start = raw.start === undefined ? today : validDate(raw.start, 'start');
	switch (raw.type) {
		case 'once':
		case 'daily':
		case 'weekly':
		case 'monthly':
			return { type: raw.type, start };
		case 'weekdays': {
			const days = (raw as { days?: unknown }).days;
			if (
				!Array.isArray(days) ||
				days.length === 0 ||
				days.some((d) => !(WEEKDAYS as readonly unknown[]).includes(d))
			)
				throw invalid('Pick at least one weekday (MO..SU)');
			const unique = WEEKDAYS.filter((d) => (days as unknown[]).includes(d));
			return { type: 'weekdays', start, days: unique };
		}
		case 'flex': {
			const every = (raw as { every?: unknown }).every;
			if (every !== 1 && every !== 2) throw invalid('schedule.every must be 1 or 2 (weeks)');
			return { type: 'flex', start, every };
		}
		default:
			throw invalid('schedule.type must be once, daily, weekdays, weekly, monthly or flex');
	}
}

export function scheduleToRRule(s: Schedule): string {
	const dtstart = `DTSTART:${s.start.replaceAll('-', '')}T000000Z`;
	if (s.type === 'flex') return `${dtstart}\nRRULE:FREQ=WEEKLY;INTERVAL=${s.every}\n${FLEX_MARK}`;
	const rule = {
		once: 'FREQ=DAILY;COUNT=1',
		daily: 'FREQ=DAILY',
		weekdays: s.type === 'weekdays' ? `FREQ=WEEKLY;BYDAY=${s.days.join(',')}` : '',
		weekly: 'FREQ=WEEKLY',
		monthly: 'FREQ=MONTHLY'
	}[s.type];
	return `${dtstart}\nRRULE:${rule}`;
}

/** Reads stored schedule text back into a friendly schedule. Unset means daily from `fallback`. */
export function parseSchedule(text: string | null, fallback: string): Schedule {
	if (!text) return { type: 'daily', start: fallback };
	const flex = flexOf(text, fallback);
	if (flex) return { type: 'flex', ...flex };
	const m = /DTSTART:(\d{4})(\d{2})(\d{2})T/.exec(text);
	const start = m ? `${m[1]}-${m[2]}-${m[3]}` : fallback;
	const rule = /RRULE:(.*)$/m.exec(text)?.[1] ?? text;
	if (rule.includes('COUNT=1')) return { type: 'once', start };
	const byday = /BYDAY=([A-Z,]+)/.exec(rule)?.[1];
	if (byday) {
		const days = WEEKDAYS.filter((d) => byday.split(',').includes(d));
		return { type: 'weekdays', start, days };
	}
	if (rule.includes('FREQ=MONTHLY')) return { type: 'monthly', start };
	if (rule.includes('FREQ=WEEKLY')) return { type: 'weekly', start };
	return { type: 'daily', start };
}

/**
 * Whether the schedule has an occurrence on the calendar day `date` (YYYY-MM-DD). A flexible to-do
 * never does: it is due once per period, on no particular day.
 */
export function isDueOn(schedule: Schedule, date: string): boolean {
	if (schedule.type === 'flex' || date < schedule.start) return false;
	const dayStart = anchor(date);
	const dayEnd = new Date(dayStart.getTime() + 86_399_999);
	const rule = rrulePkg.rrulestr(scheduleToRRule(schedule)) as RRule;
	return rule.between(dayStart, dayEnd, true).length > 0;
}

// --- CRUD --------------------------------------------------------------------------------

type Row = typeof chores.$inferSelect;

function toView(row: Row, today: string): ChoreView {
	return {
		id: row.id,
		title: row.title,
		kind: row.kind,
		icon: row.icon,
		memberIds: JSON.parse(row.memberIds) as string[],
		stars: row.stars,
		schedule: parseSchedule(row.schedule, today),
		timeOfDay: (TIMES_OF_DAY as readonly string[]).includes(row.timeOfDay ?? '')
			? (row.timeOfDay as TimeOfDay)
			: 'anytime',
		requiresApproval: row.requiresApproval,
		archived: row.archived
	};
}

/** Today in the clock's zone, else the household's (the server's own zone is never assumed). */
const todayOf = (db: Db, clock: Clock) =>
	localDateIn(clock.now ?? Date.now(), clock.timeZone ?? householdTimeZone(db));

/** Creates a chore. Approval is required unless `requiresApproval: false` (owner default). */
export function createChore(db: Db, input: ChoreInput, clock: Clock = {}): ChoreView {
	const today = todayOf(db, clock);
	const kind = input.kind === undefined ? 'star_job' : validKind(input.kind);
	const habit = kind === 'habit';
	const schedule = validSchedule(input.schedule, today);
	if (habit && schedule.type === 'flex') throw invalid('Habits are daily checks, not any-day jobs');
	const row = insertChore(db, {
		title: validTitle(input.title),
		kind,
		icon: validIcon(input.icon),
		memberIds: validMembers(db, input.memberIds ?? []),
		stars: habit ? 0 : input.stars === undefined ? 1 : validStars(input.stars),
		schedule: scheduleToRRule(schedule),
		timeOfDay: input.timeOfDay === undefined ? 'anytime' : validTimeOfDay(input.timeOfDay),
		requiresApproval: habit ? false : input.requiresApproval
	});
	return toView(row, today);
}

export function updateChore(
	db: Db,
	id: string,
	patch: Partial<ChoreInput>,
	clock: Clock = {}
): ChoreView {
	const today = todayOf(db, clock);
	const current = db.select().from(chores).where(eq(chores.id, id)).get();
	if (!current) throw new LedgerError('not_found', 'Star Job not found');
	if (patch.kind !== undefined && patch.kind !== current.kind)
		throw invalid('A Star Job cannot become a habit, or a habit a Star Job');
	if (current.kind === 'habit' && (patch.stars !== undefined || patch.requiresApproval === true))
		throw invalid('Habits earn no stars and need no approval');
	const set: Partial<Row> = {};
	if (patch.title !== undefined) set.title = validTitle(patch.title);
	if (patch.icon !== undefined) set.icon = validIcon(patch.icon);
	if (patch.memberIds !== undefined)
		set.memberIds = JSON.stringify(validMembers(db, patch.memberIds));
	if (patch.stars !== undefined) set.stars = validStars(patch.stars);
	if (patch.timeOfDay !== undefined) set.timeOfDay = validTimeOfDay(patch.timeOfDay);
	if (patch.requiresApproval !== undefined) {
		if (typeof patch.requiresApproval !== 'boolean')
			throw invalid('requiresApproval must be boolean');
		set.requiresApproval = patch.requiresApproval;
	}
	if (patch.schedule !== undefined) {
		// Keep the existing start day when only the shape changes.
		const prior = parseSchedule(current.schedule, today);
		const next = validSchedule({ start: prior.start, ...patch.schedule }, today);
		if (current.kind === 'habit' && next.type === 'flex')
			throw invalid('Habits are daily checks, not any-day jobs');
		set.schedule = scheduleToRRule(next);
	}
	if (Object.keys(set).length === 0) return toView(current, today);
	return toView(db.update(chores).set(set).where(eq(chores.id, id)).returning().get(), today);
}

export function archiveChore(db: Db, id: string, clock: Clock = {}): ChoreView {
	const row = db.update(chores).set({ archived: true }).where(eq(chores.id, id)).returning().get();
	if (!row) throw new LedgerError('not_found', 'Star Job not found');
	return toView(row, todayOf(db, clock));
}

export function listChores(
	db: Db,
	opts: { includeArchived?: boolean; kind?: ChoreKind } & Clock = {}
): ChoreView[] {
	const today = todayOf(db, opts);
	const rows = opts.includeArchived
		? db.select().from(chores).all()
		: db.select().from(chores).where(eq(chores.archived, false)).all();
	return rows
		.filter((r) => opts.kind === undefined || r.kind === opts.kind)
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
		.map((r) => toView(r, today));
}

// --- Today's chores ----------------------------------------------------------------------

const STATE_RANK: Record<CompletionState, number> = {
	none: 0,
	undone: 1,
	rejected: 2,
	pending: 3,
	approved: 4
};

/**
 * Chores due for a member on a local day, grouped morning > afternoon > evening > anytime, then
 * the flexible to-dos still open this period ('week'). One checked off on an earlier day of its
 * period is gone until the next period; one checked off today stays, showing its status.
 */
export function choresForDay(
	db: Db,
	memberId: string,
	date: string,
	timeZone: string = householdTimeZone(db)
): TimeGroup[] {
	validDate(date);
	localDateIn(0, timeZone); // validates the zone
	const mine = db
		.select()
		.from(chores)
		.where(eq(chores.archived, false))
		.all()
		.map((r) => toView(r, date))
		.filter((c) => c.memberIds.includes(memberId));

	// Two weeks back covers the longest flexible period.
	const from = addDays(date, -13);
	const done = db
		.select()
		.from(choreCompletions)
		.where(
			and(
				eq(choreCompletions.memberId, memberId),
				gte(choreCompletions.date, from),
				lte(choreCompletions.date, date)
			)
		)
		.all();
	/** The most settled completion of a chore from `first` through `date`. */
	const best = (choreId: string, first: string) => {
		let top = { status: 'none' as CompletionState, id: null as string | null, date };
		for (const c of done) {
			if (c.choreId === choreId && c.date >= first && STATE_RANK[c.status] > STATE_RANK[top.status])
				top = { status: c.status, id: c.id, date: c.date };
		}
		return top;
	};

	const groups = new Map<DueGroup, DueChore[]>(
		[...TIMES_OF_DAY, 'week' as const].map((t) => [t, []])
	);
	for (const chore of mine) {
		const s = chore.schedule;
		if (s.type === 'flex') {
			const period = flexPeriod(s.start, s.every, date);
			if (!period) continue;
			const top = best(chore.id, period.start);
			const checked = top.status === 'pending' || top.status === 'approved';
			if (checked && top.date !== date) continue;
			groups.get('week')!.push({
				...chore,
				status: checked ? top.status : 'none',
				completionId: checked ? top.id : null,
				flex: { dueBy: period.end, week: period.week, weeks: period.weeks }
			});
		} else if (isDueOn(s, date)) {
			const top = best(chore.id, date);
			groups.get(chore.timeOfDay)!.push({ ...chore, status: top.status, completionId: top.id });
		}
	}
	return [...groups]
		.map(([timeOfDay, list]) => ({ timeOfDay, chores: list }))
		.filter((g) => g.chores.length > 0);
}
