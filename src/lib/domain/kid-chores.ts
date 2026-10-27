import { activeRoutines, parseMinutes, type KidRoutine } from '#lib/domain/routines.js';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Status = 'none' | 'pending' | 'approved' | 'rejected' | 'undone';

export interface KidChore {
	id: string;
	title: string;
	/** Star Jobs earn stars; habits are plain checks (hub-esf). Missing means a Star Job. */
	kind?: 'star_job' | 'habit';
	icon: string | null;
	stars: number;
	/** False: the stars count the moment the kid taps (no grown-up's OK). Missing means true. */
	requiresApproval?: boolean;
	status: Status;
	completionId: string | null;
	/** Any-day to-dos (hub-it5): the period's last day and which of its weeks today is in. */
	flex?: KidFlex;
}

export interface KidFlex {
	dueBy: string;
	week: number;
	weeks: number;
}

/** 'week' holds the any-day to-dos still open this week (or two). */
export type KidGroupKey = TimeOfDay | 'week';

export interface KidGroup {
	timeOfDay: KidGroupKey;
	chores: KidChore[];
}

/** How long a kid can take a tap back (matches KID_UNDO_WINDOW_MS on the server). */
export const UNDO_WINDOW_MS = 10_000;
export const MAX_JAR_SLOTS = 24;

export const GROUP_HEADINGS: Record<KidGroupKey, { emoji: string; label: string }> = {
	morning: { emoji: '🌅', label: 'This morning' },
	afternoon: { emoji: '☀️', label: 'This afternoon' },
	evening: { emoji: '🌙', label: 'Tonight' },
	anytime: { emoji: '⭐', label: 'Anytime today' },
	week: { emoji: '📅', label: 'This week · any day' }
};

const WEEKDAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];

/** "Due by Sunday", or for a two-week job "Week 1 of 2 · due by next Sunday". */
export function flexNote(flex: KidFlex): string {
	const day = WEEKDAY_NAMES[new Date(`${flex.dueBy}T00:00:00Z`).getUTCDay()];
	if (flex.weeks < 2) return `Due by ${day}`;
	const next = flex.week < flex.weeks ? 'next ' : '';
	return `Week ${flex.week} of ${flex.weeks} · due by ${next}${day}`;
}

/** The local calendar day (YYYY-MM-DD) for an instant in an IANA time zone. */
export function localDate(now: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(now));
}

export function isDoable(status: Status): boolean {
	return status === 'none' || status === 'rejected' || status === 'undone';
}

function mapChore(groups: KidGroup[], choreId: string, fn: (c: KidChore) => KidChore): KidGroup[] {
	return groups.map((g) => ({
		...g,
		chores: g.chores.map((c) => (c.id === choreId ? fn(c) : c))
	}));
}

export function setStatus(
	groups: KidGroup[],
	choreId: string,
	status: Status,
	completionId: string | null
): KidGroup[] {
	return mapChore(groups, choreId, (c) => ({ ...c, status, completionId }));
}

export function undoSecondsLeft(startedAt: number, now: number): number {
	return Math.max(0, Math.ceil((UNDO_WINDOW_MS - (now - startedAt)) / 1000));
}

export interface JarSlots {
	total: number;
	gold: number;
	pending: number;
}

export function jarSlots(balance: number, pending: number, goalCost: number | null): JarSlots {
	const b = Math.max(0, Math.floor(balance));
	const p = Math.max(0, Math.floor(pending));
	const wanted = goalCost && goalCost > 0 ? goalCost : Math.ceil((b + p) / 5) * 5;
	const total = Math.min(MAX_JAR_SLOTS, Math.max(10, wanted));
	const gold = Math.min(b, total);
	return { total, gold, pending: Math.min(p, total - gold) };
}

/** Members with at least one chore today. */
export function kidsWithChores<T extends { id: string }>(
	members: T[],
	boards: Record<string, KidGroup[]>
): T[] {
	return members.filter((m) => (boards[m.id]?.length ?? 0) > 0);
}

/**
 * Every child is on the kid screen, chores or not (hub-kko.6): the star jar, goals, Shop and
 * Log reading are reasons to visit besides chores. A kid with nothing today sees "All free today!".
 * (This used to hide kids with no chores or open routine, so they could not reach any of that.)
 */
export function kidsToShow<T extends { id: string }>(members: T[]): T[] {
	return members;
}

/**
 * Who is selected when the screen opens: the wanted kid (?member= or last used), else the first
 * kid with chores or an open routine, else the first kid.
 */
export function defaultKid<T extends { id: string }>(
	members: T[],
	boards: Record<string, KidGroup[]>,
	routinesBy: Record<string, KidRoutine[]>,
	nowMinutes: number,
	wantId: string | null = null
): T | null {
	return (
		members.find((m) => m.id === wantId) ??
		members.find(
			(m) =>
				(boards[m.id]?.length ?? 0) > 0 ||
				activeRoutines(routinesBy[m.id] ?? [], nowMinutes).length > 0
		) ??
		members[0] ??
		null
	);
}

/** Done means checked off: waiting for a grown-up or approved. */
const isChecked = (c: KidChore) => c.status === 'pending' || c.status === 'approved';

export const isHabit = (c: KidChore) => c.kind === 'habit';

/** The Star Jobs part of a board, keeping its time-of-day groups (empty groups dropped). */
export function starJobGroups(groups: KidGroup[]): KidGroup[] {
	return groups
		.map((g) => ({ ...g, chores: g.chores.filter((c) => !isHabit(c)) }))
		.filter((g) => g.chores.length > 0);
}

/** Today's habits, in board order. */
export const habitChores = (groups: KidGroup[]): KidChore[] =>
	groups.flatMap((g) => g.chores.filter(isHabit));

export interface Count {
	done: number;
	total: number;
}

/** How many of these chores are checked off. */
export const doneCount = (chores: KidChore[]): Count => ({
	done: chores.filter(isChecked).length,
	total: chores.length
});

/** Today's habit counter: habits plus routines, each routine one habit done when finished. */
export function habitCount(habits: KidChore[], routines: KidRoutine[]): Count {
	const real = routines.filter((r) => r.steps.length > 0);
	return {
		done: habits.filter(isChecked).length + real.filter((r) => r.done >= r.steps.length).length,
		total: habits.length + real.length
	};
}

/** The three parts of the kid's day, side by side on the To-Dos board (hub-3yg). */
export type ColumnKey = 'morning' | 'afternoon' | 'evening';

export const COLUMN_HEADINGS: Record<ColumnKey, string> = {
	morning: 'Morning',
	afternoon: 'After school',
	evening: 'Tonight'
};

const COLUMN_ORDER: ColumnKey[] = ['morning', 'afternoon', 'evening'];
const NOON = 12 * 60;
const EVENING_START = 17 * 60;

/** Which part of the day a clock time (minutes since midnight) falls in. */
export function columnAt(minutes: number): ColumnKey {
	if (minutes < NOON) return 'morning';
	return minutes < EVENING_START ? 'afternoon' : 'evening';
}

/** A routine sits in the column its window opens in; with no window it follows the clock. */
export function routineColumn(routine: KidRoutine, nowMinutes: number): ColumnKey {
	const start = parseMinutes(routine.windowStart);
	return columnAt(start ?? nowMinutes);
}

export interface TimeColumn {
	key: ColumnKey;
	label: string;
	/** The part of the day it is right now. */
	now: boolean;
	routines: KidRoutine[];
	chores: KidChore[];
	/** Any-day to-dos still open this week: shown in the Now column, after the rest. */
	weekly: KidChore[];
}

/**
 * Lays a board out in time columns. Star Jobs and habits share one list per column; to-dos with no
 * time of day ("anytime") and any-day to-dos follow the clock into the Now column.
 */
export function timeColumns(
	groups: KidGroup[],
	routines: KidRoutine[],
	nowMinutes: number
): TimeColumn[] {
	const now = columnAt(nowMinutes);
	const pick = (key: KidGroupKey) =>
		groups.filter((g) => g.timeOfDay === key).flatMap((g) => g.chores);
	return COLUMN_ORDER.map((key) => ({
		key,
		label: COLUMN_HEADINGS[key],
		now: key === now,
		routines: routines.filter((r) => routineColumn(r, nowMinutes) === key),
		chores: [...pick(key), ...(key === now ? pick('anytime') : [])],
		weekly: key === now ? pick('week') : []
	}));
}
