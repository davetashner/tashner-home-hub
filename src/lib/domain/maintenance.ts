/**
 * House maintenance (hub-nit): recurring jobs like "change the HVAC filter" with a frequency,
 * a next due day and the day it was last done. Pure: dates are `YYYY-MM-DD` household days and
 * "today" is passed in, never read from the browser's or the container's clock.
 */
import { dayNumber, isCalendarDate } from './countdowns.js';

export interface MaintenanceTaskLike {
	id: string;
	title: string;
	/** Months between services; null means "as needed" (no schedule). */
	intervalMonths: number | null;
	/** Next due day, or null when nothing is scheduled. */
	nextDue: string | null;
	/** Day it was last done, or null when never recorded. */
	lastDone: string | null;
	/** Free text such as "1 hour". */
	estTime: string | null;
	notes: string | null;
}

export const MAINTENANCE_TITLE_MAX = 60;
export const MAINTENANCE_TIME_MAX = 30;
export const MAINTENANCE_NOTES_MAX = 200;
/** Ten years: longer than anything a house needs (a septic tank is every 3-5). */
export const MAINTENANCE_INTERVAL_MAX = 120;
/** A task due within this many days shows as "soon". */
export const MAINTENANCE_SOON_DAYS = 30;

/** Frequencies offered by the form, in months; null is "as needed". */
export const MAINTENANCE_FREQUENCIES: readonly (number | null)[] = [1, 3, 6, 12, 24, 36, 60, null];

export type MaintenanceStatus = 'overdue' | 'due' | 'soon' | 'later' | 'unscheduled';

/**
 * `date` plus whole months, clamped to the end of a shorter month (Jan 31 + 1 month is Feb 28),
 * so a job done on the 31st never drifts into the following month.
 */
export function addMonths(date: string, months: number): string {
	if (dayNumber(date) === null) throw new RangeError(`not a calendar day: ${date}`);
	const [y, m, d] = date.split('-').map(Number);
	const total = y * 12 + (m - 1) + months;
	const year = Math.floor(total / 12);
	const month = total - year * 12;
	const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** The next due day after finishing on `done`; null for an as-needed task. */
export function nextDueAfter(done: string, intervalMonths: number | null): string | null {
	return intervalMonths === null ? null : addMonths(done, intervalMonths);
}

/** Overdue before today, due today, soon within the window, later beyond it. */
export function statusOf(
	task: Pick<MaintenanceTaskLike, 'nextDue'>,
	today: string
): MaintenanceStatus {
	if (task.nextDue === null) return 'unscheduled';
	const a = dayNumber(task.nextDue);
	const b = dayNumber(today);
	if (a === null || b === null) return 'unscheduled';
	if (a < b) return 'overdue';
	if (a === b) return 'due';
	return a - b <= MAINTENANCE_SOON_DAYS ? 'soon' : 'later';
}

/** Due today or overdue: what the Lists menu badge counts. */
export const isDue = (task: Pick<MaintenanceTaskLike, 'nextDue'>, today: string): boolean => {
	const s = statusOf(task, today);
	return s === 'overdue' || s === 'due';
};

export const dueCount = (tasks: readonly Pick<MaintenanceTaskLike, 'nextDue'>[], today: string) =>
	tasks.filter((t) => isDue(t, today)).length;

/** Soonest due first; unscheduled tasks last; ties by title. */
export function sortTasks<T extends MaintenanceTaskLike>(tasks: readonly T[]): T[] {
	return [...tasks].sort((a, b) => {
		if (a.nextDue !== b.nextDue) {
			if (a.nextDue === null) return 1;
			if (b.nextDue === null) return -1;
			return a.nextDue.localeCompare(b.nextDue);
		}
		return a.title.localeCompare(b.title);
	});
}

const NAMED: Record<number, string> = {
	1: 'Monthly',
	3: 'Quarterly',
	6: 'Every 6 months',
	12: 'Annually'
};

/** "Quarterly", "Every 3 years", "Every 18 months", "As needed". */
export function frequencyLabel(intervalMonths: number | null): string {
	if (intervalMonths === null) return 'As needed';
	if (NAMED[intervalMonths]) return NAMED[intervalMonths];
	if (intervalMonths % 12 === 0) return `Every ${intervalMonths / 12} years`;
	return `Every ${intervalMonths} months`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 18, 2026"; an invalid day comes back unchanged. */
export function formatDay(date: string): string {
	if (!isCalendarDate(date)) return date;
	const [y, m, d] = date.split('-').map(Number);
	return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Overdue by 3 days", "Due today", "Due in 12 days", "Due Nov 18, 2027", "As needed". */
export function dueLabel(task: Pick<MaintenanceTaskLike, 'nextDue'>, today: string): string {
	const status = statusOf(task, today);
	if (status === 'unscheduled') return 'As needed';
	const days = dayNumber(task.nextDue!)! - dayNumber(today)!;
	const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
	if (status === 'overdue') return `Overdue by ${plural(-days)}`;
	if (status === 'due') return 'Due today';
	if (status === 'soon') return `Due in ${plural(days)}`;
	return `Due ${formatDay(task.nextDue!)}`;
}

/** A whole number of months in range, or null for as needed; undefined when invalid. */
export function parseInterval(v: unknown): number | null | undefined {
	if (v === null || v === undefined || v === '') return null;
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAINTENANCE_INTERVAL_MAX
		? n
		: undefined;
}
