import type { NewEvent } from './ics-build.js';
import { fromWall, parseDate, parseWall } from './time.js';

export const TITLE_MAX = 200;
export const LOCATION_MAX = 200;
export const NOTES_MAX = 2000;
const DAY = 86_400_000;
/** Stops a typo like year 2206 from writing an event nobody can find. */
const MAX_SPAN_MS = 366 * DAY;

export class NewEventError extends Error {}

export interface NewEventInput {
	title: unknown;
	allDay: unknown;
	/** All-day: `YYYY-MM-DD`. Timed: household wall time `YYYY-MM-DDTHH:mm`. */
	start: unknown;
	/** All-day: the last day, inclusive (`YYYY-MM-DD`). Timed: wall time, after `start`. */
	end: unknown;
	location?: unknown;
	notes?: unknown;
}

function optionalText(v: unknown, name: string, max: number): string | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== 'string') throw new NewEventError(`${name} must be text`);
	const t = v.trim();
	if (t.length > max) throw new NewEventError(`${name} must be at most ${max} characters`);
	return t || undefined;
}

function dateOnly(v: unknown, name: string): number {
	if (typeof v !== 'string') throw new NewEventError(`${name} must be YYYY-MM-DD`);
	try {
		const ms = parseDate(v);
		if (new Date(ms).toISOString().slice(0, 10) !== v) throw new Error();
		return ms;
	} catch {
		throw new NewEventError(`${name} must be a valid YYYY-MM-DD date`);
	}
}

function wallTime(v: unknown, name: string, zone: string): number {
	if (typeof v !== 'string') throw new NewEventError(`${name} must be YYYY-MM-DDTHH:mm`);
	try {
		const wall = parseWall(v);
		if (new Date(wall).toISOString().slice(0, 16) !== v.slice(0, 16)) throw new Error();
		return fromWall(wall, zone);
	} catch {
		throw new NewEventError(`${name} must be a valid YYYY-MM-DDTHH:mm time`);
	}
}

/** Validates a create request and resolves it to absolute times in the household zone. */
export function resolveNewEvent(input: NewEventInput, zone: string): NewEvent {
	if (typeof input.title !== 'string') throw new NewEventError('title is required');
	const title = input.title.trim();
	if (title.length < 1 || title.length > TITLE_MAX)
		throw new NewEventError(`title must be 1 to ${TITLE_MAX} characters`);
	if (typeof input.allDay !== 'boolean') throw new NewEventError('allDay must be true or false');
	const location = optionalText(input.location, 'location', LOCATION_MAX);
	const notes = optionalText(input.notes, 'notes', NOTES_MAX);
	const rest = {
		title,
		...(location ? { location } : {}),
		...(notes ? { notes } : {})
	};
	if (input.allDay) {
		const start = dateOnly(input.start, 'start');
		const last = dateOnly(input.end, 'end');
		if (last < start) throw new NewEventError('end must not be before start');
		if (last - start > MAX_SPAN_MS) throw new NewEventError('An event can span at most a year');
		const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
		return {
			...rest,
			time: { allDay: true, startDate: iso(start), endDate: iso(last + DAY) }
		};
	}
	const startMs = wallTime(input.start, 'start', zone);
	const endMs = wallTime(input.end, 'end', zone);
	if (endMs <= startMs) throw new NewEventError('end must be after start');
	if (endMs - startMs > MAX_SPAN_MS) throw new NewEventError('An event can span at most a year');
	return { ...rest, time: { allDay: false, startMs, endMs } };
}
