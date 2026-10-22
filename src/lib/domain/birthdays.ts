/**
 * Birthday dates (hub-6pv.6.10): the days the household wants the birthday scene on the wall.
 * Month and day only, repeating every year. The labels are for the settings page alone and never
 * reach the wall. The dates live in the runtime database, never in the repo. Pure.
 */
export const BIRTHDAYS_SETTING_KEY = 'wave.birthdays';
export const MAX_BIRTHDAYS = 24;
export const MAX_LABEL = 40;

export interface BirthdayDate {
	/** 1-12. */
	month: number;
	day: number;
}
export interface Birthday extends BirthdayDate {
	/** Shown in settings only. */
	label?: string;
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;
export const monthName = (month: number) => MONTH_NAMES[month - 1] ?? '';

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Days in a month, counting Feb 29 (the date repeats yearly, so the list allows it). */
export const daysInMonth = (month: number) =>
	month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;

/** A real calendar date; Feb 29 is allowed. */
export const isRealDate = (month: unknown, day: unknown): boolean =>
	Number.isInteger(month) &&
	Number.isInteger(day) &&
	(month as number) >= 1 &&
	(month as number) <= 12 &&
	(day as number) >= 1 &&
	(day as number) <= daysInMonth(month as number);

const keyOf = (b: BirthdayDate) => b.month * 100 + b.day;

/** Calendar order (January first), the order settings shows them in. */
export const sortBirthdays = <T extends BirthdayDate>(list: readonly T[]): T[] =>
	[...list].sort((a, b) => keyOf(a) - keyOf(b));

/**
 * Validates a PUT body `{ birthdays: [{ month, day, label? }] }`; returns the clean sorted list or
 * an error message. A repeated date is an error, so a double tap can't stack the same day twice.
 */
export function parseBirthdays(body: Record<string, unknown>): Birthday[] | string {
	const raw = body.birthdays;
	if (!Array.isArray(raw)) return 'birthdays must be a list';
	if (raw.length > MAX_BIRTHDAYS) return `at most ${MAX_BIRTHDAYS} birthdays`;
	const seen = new Set<number>();
	const out: Birthday[] = [];
	for (const item of raw) {
		const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		if (!isRealDate(o.month, o.day)) return 'each birthday needs a real month and day';
		const date = { month: o.month as number, day: o.day as number };
		if (seen.has(keyOf(date))) return 'each date can be listed only once';
		seen.add(keyOf(date));
		if (o.label === undefined || o.label === null || o.label === '') {
			out.push(date);
			continue;
		}
		if (typeof o.label !== 'string' || o.label.trim().length > MAX_LABEL)
			return `label must be text up to ${MAX_LABEL} characters`;
		out.push({ ...date, label: o.label.trim() });
	}
	return sortBirthdays(out);
}

/** A stored value read back leniently: anything invalid is dropped, never an error. */
export function resolveBirthdays(stored: unknown): Birthday[] {
	if (!Array.isArray(stored)) return [];
	const seen = new Set<number>();
	const good: Birthday[] = [];
	for (const item of stored) {
		const one = parseBirthdays({ birthdays: [item] });
		if (typeof one === 'string' || !one[0] || seen.has(keyOf(one[0]))) continue;
		seen.add(keyOf(one[0]));
		good.push(one[0]);
	}
	return sortBirthdays(good).slice(0, MAX_BIRTHDAYS);
}

/** What the wall gets: the dates only, labels stripped. */
export const birthdayDates = (list: readonly Birthday[]): BirthdayDate[] =>
	list.map(({ month, day }) => ({ month, day }));

/**
 * Is this calendar date a birthday? A Feb 29 birthday shows on Feb 28 in a year without a Feb 29,
 * so it never skips a year. Without a year, Feb 29 matches only Feb 29.
 */
export function isBirthday(
	list: readonly BirthdayDate[],
	month: number,
	day: number,
	year?: number
): boolean {
	const shiftLeap = month === 2 && day === 28 && year !== undefined && !isLeap(year);
	return list.some(
		(b) => (b.month === month && b.day === day) || (shiftLeap && b.month === 2 && b.day === 29)
	);
}
