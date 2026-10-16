/**
 * Time-zone-safe day math for the calendar views. Days are identified by a
 * `YYYY-MM-DD` key in a given IANA zone, so DST days (23 or 25 hours) never
 * break day boundaries.
 */
export type DateKey = string;

export const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(timeZone, f);
	}
	return f;
}

function wallParts(ms: number, timeZone: string) {
	const p: Record<string, number> = {};
	for (const { type, value } of formatter(timeZone).formatToParts(ms)) p[type] = Number(value);
	return p;
}

/** Zone offset from UTC in ms at an instant (positive east of UTC). */
export function offsetAt(ms: number, timeZone: string): number {
	const p = wallParts(ms, timeZone);
	const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return wall - Math.floor(ms / 1000) * 1000;
}

export function pad(n: number): string {
	return String(n).padStart(2, '0');
}

export function toKey(y: number, m: number, d: number): DateKey {
	return `${y}-${pad(m)}-${pad(d)}`;
}

function parseKey(key: DateKey): [number, number, number] {
	const [y, m, d] = key.split('-').map(Number);
	return [y, m, d];
}

/** The local calendar day an instant falls on. */
export function dateKeyOf(ms: number, timeZone: string): DateKey {
	const p = wallParts(ms, timeZone);
	return toKey(p.year, p.month, p.day);
}

/** The calendar date of a UTC-midnight instant (how all-day events are stored). */
export function utcDateKey(ms: number): DateKey {
	const d = new Date(ms);
	return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Epoch ms of local `minutes` after midnight on `key` (wall-clock; DST-safe). */
export function zonedMs(key: DateKey, minutes: number, timeZone: string): number {
	const [y, m, d] = parseKey(key);
	const wall = Date.UTC(y, m - 1, d) + minutes * 60_000;
	const guess = wall - offsetAt(wall, timeZone);
	return wall - offsetAt(guess, timeZone);
}

export function dayStartMs(key: DateKey, timeZone: string): number {
	return zonedMs(key, 0, timeZone);
}

export function addDays(key: DateKey, n: number): DateKey {
	const [y, m, d] = parseKey(key);
	return utcDateKey(Date.UTC(y, m - 1, d + n));
}

export function daysBetween(a: DateKey, b: DateKey): number {
	const [ay, am, ad] = parseKey(a);
	const [by, bm, bd] = parseKey(b);
	return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** 0 = Sunday. */
export function weekday(key: DateKey): number {
	const [y, m, d] = parseKey(key);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeek(key: DateKey, weekStartsOn = 0): DateKey {
	return addDays(key, -((weekday(key) - weekStartsOn + 7) % 7));
}

export function firstOfMonth(key: DateKey): DateKey {
	const [y, m] = parseKey(key);
	return toKey(y, m, 1);
}

export function addMonths(key: DateKey, n: number): DateKey {
	const [y, m] = parseKey(key);
	const t = new Date(Date.UTC(y, m - 1 + n, 1));
	return toKey(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

export function sameMonth(a: DateKey, b: DateKey): boolean {
	return a.slice(0, 7) === b.slice(0, 7);
}

export function range(start: DateKey, count: number): DateKey[] {
	return Array.from({ length: count }, (_, i) => addDays(start, i));
}
