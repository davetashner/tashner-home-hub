/**
 * The weekly reading and practice chart (hub-kko.3). Pure aggregation, no I/O: the server reads a
 * member's active logs for the week and this folds them into seven days, Monday first.
 */
const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDate = (s: unknown): s is string =>
	typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromMs(toMs(s)) === s;

/** The seven dates, Monday to Sunday, of the week holding `date`. */
export function weekDates(date: string): string[] {
	const ms = toMs(date);
	const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
	return Array.from({ length: 7 }, (_, i) => fromMs(monday + i * DAY_MS));
}

/** `date` moved by whole weeks (negative goes back). */
export const shiftWeeks = (date: string, weeks: number): string =>
	fromMs(toMs(date) + weeks * 7 * DAY_MS);

export interface WeekLog {
	date: string;
	activityId: string;
	minutes: number;
	stars: number;
}

export interface WeekDay {
	date: string;
	minutes: number;
	isToday: boolean;
	byActivity: Record<string, number>;
}

export interface PracticeWeek {
	weekStart: string;
	days: WeekDay[];
	/** Minutes per activity over the week, biggest first. */
	activities: { activityId: string; minutes: number }[];
	totalMinutes: number;
	/** Stars the week's active logs earned. */
	stars: number;
}

/** Folds active logs into the week holding `date`; logs outside it are ignored. */
export function buildWeek(logs: WeekLog[], date: string, today: string): PracticeWeek {
	const dates = weekDates(date);
	const days: WeekDay[] = dates.map((d) => ({
		date: d,
		minutes: 0,
		isToday: d === today,
		byActivity: {}
	}));
	const perActivity = new Map<string, number>();
	let stars = 0;
	for (const l of logs) {
		const day = days.find((d) => d.date === l.date);
		if (!day) continue;
		day.minutes += l.minutes;
		day.byActivity[l.activityId] = (day.byActivity[l.activityId] ?? 0) + l.minutes;
		perActivity.set(l.activityId, (perActivity.get(l.activityId) ?? 0) + l.minutes);
		stars += l.stars;
	}
	return {
		weekStart: dates[0]!,
		days,
		activities: [...perActivity]
			.map(([activityId, minutes]) => ({ activityId, minutes }))
			.sort((a, b) => b.minutes - a.minutes),
		totalMinutes: days.reduce((n, d) => n + d.minutes, 0),
		stars
	};
}

/** The kid-facing line under the chart. */
export function weekLine(totalMinutes: number, stars: number): string {
	if (totalMinutes === 0) return 'No reading yet this week. Log some!';
	const s = `${stars} ${stars === 1 ? 'star' : 'stars'}`;
	return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'} this week, ${s}`;
}
