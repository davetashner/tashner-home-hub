/**
 * Chore model + scheduling (requirements CHO-1, CHO-2; §3.4).
 *
 * Schedules are stored as RFC 5545 text (`DTSTART:...` + `RRULE:...`) via the `rrule`
 * package, but the API speaks a friendly {@link Schedule}. Chores are day-granular, so
 * every date is a "floating" calendar day anchored at 00:00 UTC. Recurrence therefore
 * never touches a local clock and cannot drift across a DST change; the time zone is only
 * used to decide what "today" is.
 */
import { and, eq, inArray } from 'drizzle-orm';
import rrulePkg from 'rrule';
import type { RRule } from 'rrule';
import type { Db } from '../db/index.js';
import { choreCompletions, chores, members } from '../db/schema.js';
import { LedgerError, createChore as insertChore } from './ledger.js';

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Friendly schedule. `start` is the first local day (YYYY-MM-DD) and anchors weekly/monthly. */
export type Schedule =
	| { type: 'once'; start: string }
	| { type: 'daily'; start: string }
	| { type: 'weekdays'; start: string; days: Weekday[] }
	| { type: 'weekly'; start: string }
	| { type: 'monthly'; start: string };

export type CompletionState = 'none' | 'pending' | 'approved' | 'rejected' | 'undone';

export interface ChoreView {
	id: string;
	title: string;
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
}

export interface TimeGroup {
	timeOfDay: TimeOfDay;
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

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

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
		default:
			throw invalid('schedule.type must be once, daily, weekdays, weekly or monthly');
	}
}

export function scheduleToRRule(s: Schedule): string {
	const dtstart = `DTSTART:${s.start.replaceAll('-', '')}T000000Z`;
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

/** Whether the schedule has an occurrence on the calendar day `date` (YYYY-MM-DD). */
export function isDueOn(schedule: Schedule, date: string): boolean {
	if (date < schedule.start) return false;
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

const todayOf = (clock: Clock) =>
	localDateIn(clock.now ?? Date.now(), clock.timeZone ?? systemZone());

/** Creates a chore. Approval is required unless `requiresApproval: false` (owner default). */
export function createChore(db: Db, input: ChoreInput, clock: Clock = {}): ChoreView {
	const today = todayOf(clock);
	const row = insertChore(db, {
		title: validTitle(input.title),
		icon: validIcon(input.icon),
		memberIds: validMembers(db, input.memberIds ?? []),
		stars: input.stars === undefined ? 1 : validStars(input.stars),
		schedule: scheduleToRRule(validSchedule(input.schedule, today)),
		timeOfDay: input.timeOfDay === undefined ? 'anytime' : validTimeOfDay(input.timeOfDay),
		requiresApproval: input.requiresApproval
	});
	return toView(row, today);
}

export function updateChore(
	db: Db,
	id: string,
	patch: Partial<ChoreInput>,
	clock: Clock = {}
): ChoreView {
	const today = todayOf(clock);
	const current = db.select().from(chores).where(eq(chores.id, id)).get();
	if (!current) throw new LedgerError('not_found', 'Chore not found');
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
		set.schedule = scheduleToRRule(validSchedule({ start: prior.start, ...patch.schedule }, today));
	}
	if (Object.keys(set).length === 0) return toView(current, today);
	return toView(db.update(chores).set(set).where(eq(chores.id, id)).returning().get(), today);
}

export function archiveChore(db: Db, id: string, clock: Clock = {}): ChoreView {
	const row = db.update(chores).set({ archived: true }).where(eq(chores.id, id)).returning().get();
	if (!row) throw new LedgerError('not_found', 'Chore not found');
	return toView(row, todayOf(clock));
}

export function listChores(db: Db, opts: { includeArchived?: boolean } & Clock = {}): ChoreView[] {
	const today = todayOf(opts);
	const rows = opts.includeArchived
		? db.select().from(chores).all()
		: db.select().from(chores).where(eq(chores.archived, false)).all();
	return rows
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

/** Chores due for a member on a local day, grouped morning > afternoon > evening > anytime. */
export function choresForDay(
	db: Db,
	memberId: string,
	date: string,
	timeZone: string = systemZone()
): TimeGroup[] {
	validDate(date);
	localDateIn(0, timeZone); // validates the zone
	const due = db
		.select()
		.from(chores)
		.where(eq(chores.archived, false))
		.all()
		.map((r) => toView(r, date))
		.filter((c) => c.memberIds.includes(memberId) && isDueOn(c.schedule, date));

	const done = db
		.select()
		.from(choreCompletions)
		.where(and(eq(choreCompletions.memberId, memberId), eq(choreCompletions.date, date)))
		.all();

	const groups = new Map<TimeOfDay, DueChore[]>(TIMES_OF_DAY.map((t) => [t, []]));
	for (const chore of due) {
		let best: { status: CompletionState; id: string | null } = { status: 'none', id: null };
		for (const c of done) {
			if (c.choreId === chore.id && STATE_RANK[c.status] > STATE_RANK[best.status])
				best = { status: c.status, id: c.id };
		}
		groups.get(chore.timeOfDay)!.push({ ...chore, status: best.status, completionId: best.id });
	}
	return TIMES_OF_DAY.map((t) => ({ timeOfDay: t, chores: groups.get(t)! })).filter(
		(g) => g.chores.length > 0
	);
}
