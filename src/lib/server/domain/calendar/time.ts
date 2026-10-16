import type { RemoteTime } from './types.js';

const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
	let f = formatters.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(tz, f);
	}
	return f;
}

/** Wall-clock fields of `utcMs` in `tz`, encoded as if they were UTC ("fake UTC"). */
export function toWall(utcMs: number, tz: string): number {
	const p: Record<string, number> = {};
	for (const part of fmt(tz).formatToParts(new Date(utcMs))) {
		if (part.type !== 'literal') p[part.type] = Number(part.value);
	}
	return Date.UTC(p.year!, p.month! - 1, p.day, p.hour, p.minute, p.second);
}

/** Converts a wall-clock time (fake UTC) in `tz` to a real instant. Gaps move forward; overlaps pick the first. */
export function fromWall(wall: number, tz: string): number {
	if (tz === 'UTC') return wall;
	const offset = (at: number) => toWall(at, tz) - at;
	const before = wall - offset(wall - DAY);
	const after = wall - offset(wall + DAY);
	const valid = [before, after].filter((c) => toWall(c, tz) === wall);
	return valid.length ? Math.min(...valid) : before;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseDate(s: string): number {
	const m = DATE_RE.exec(s);
	if (!m) throw new Error(`Invalid date: ${s}`);
	return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
}

/** `YYYY-MM-DDTHH:mm[:ss]` as fake UTC. */
export function parseWall(s: string): number {
	const m = DT_RE.exec(s);
	if (!m) throw new Error(`Invalid dateTime: ${s}`);
	return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0);
}

export function isAllDay(t: RemoteTime): t is { date: string } {
	return 'date' in t;
}

/** Real instant for a timed value; UTC midnight for a date-only value (no zone shift). */
export function toInstant(t: RemoteTime): number {
	return isAllDay(t) ? parseDate(t.date) : fromWall(parseWall(t.dateTime), t.timeZone);
}

export function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export { DAY };
