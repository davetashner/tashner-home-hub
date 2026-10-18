/**
 * Vacation mode (hub-k0w): one household-wide date range during which streaks are paused.
 * Pure rules; the server module stores the range in the settings table.
 *
 * A vacation starts on `start` and runs up to, not including, `back` (the first day back). A null
 * `back` means open-ended: on until a grown-up turns it off. Vacation days count as `none` in the
 * streak rules, so they neither extend nor break a run.
 */

export interface Vacation {
	/** First vacation day, YYYY-MM-DD. */
	start: string;
	/** First day back (not a vacation day), or null for open-ended. */
	back: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isDateString = (v: unknown): v is string =>
	typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Coerces untrusted JSON into a vacation, or null when it is missing or malformed. */
export function parseVacation(raw: unknown): Vacation | null {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	if (!isDateString(o.start)) return null;
	if (o.back === null || o.back === undefined) return { start: o.start, back: null };
	if (!isDateString(o.back) || o.back <= o.start) return null;
	return { start: o.start, back: o.back };
}

/** True when `date` falls inside the vacation. */
export function isVacationDay(vacation: Vacation | null, date: string): boolean {
	if (!vacation) return false;
	return date >= vacation.start && (vacation.back === null || date < vacation.back);
}
