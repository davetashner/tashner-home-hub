import type { CalEvent } from './layout.js';
import { addDays, dateKeyOf, dayStartMs, pad, utcDateKey, zonedMs, type DateKey } from './zone.js';

/** Time pickers move in quarter hours. */
export const STEP_MIN = 15;
export const LAST_START = 24 * 60 - 2 * STEP_MIN;
export const LAST_END = 24 * 60 - STEP_MIN;
export const TITLE_MAX = 200;
export const LOCATION_MAX = 200;
export const NOTES_MAX = 2000;

export interface EventDraft {
	title: string;
	allDay: boolean;
	/** First day. */
	date: DateKey;
	/** Last day, inclusive (all-day only). */
	endDate: DateKey;
	/** Minutes after midnight in the household zone. */
	startMin: number;
	endMin: number;
	location: string;
	notes: string;
	calendarId: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const snap = (n: number) => Math.round(n / STEP_MIN) * STEP_MIN;

/** A blank draft on `date`: the next whole hour from `nowMin` for one hour (kept inside the day). */
export function newDraft(date: DateKey, nowMin: number, calendarId: string): EventDraft {
	const startMin = clamp(Math.ceil((nowMin + 1) / 60) * 60, 0, LAST_START - 45);
	return {
		title: '',
		allDay: false,
		date,
		endDate: date,
		startMin,
		endMin: startMin + 60,
		location: '',
		notes: '',
		calendarId
	};
}

/** Moves the start and keeps the length (never past the end of the day). */
export function setStart(d: EventDraft, startMin: number): EventDraft {
	const start = clamp(snap(startMin), 0, LAST_START);
	const length = d.endMin - d.startMin;
	return { ...d, startMin: start, endMin: clamp(start + length, start + STEP_MIN, LAST_END) };
}

export function setEnd(d: EventDraft, endMin: number): EventDraft {
	return { ...d, endMin: clamp(snap(endMin), d.startMin + STEP_MIN, LAST_END) };
}

/** Moves the first day; the last day follows so the length is kept. */
export function setDate(d: EventDraft, date: DateKey, daysSpan = spanDays(d)): EventDraft {
	return { ...d, date, endDate: addDays(date, daysSpan) };
}

export function setEndDate(d: EventDraft, endDate: DateKey): EventDraft {
	return { ...d, endDate: endDate < d.date ? d.date : endDate };
}

function spanDays(d: EventDraft): number {
	const a = Date.parse(`${d.date}T00:00:00Z`);
	const b = Date.parse(`${d.endDate}T00:00:00Z`);
	return Math.round((b - a) / 86_400_000);
}

export const clock = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** `7:45 PM` */
export function clockLabel(min: number): string {
	const h = Math.floor(min / 60);
	return `${h % 12 || 12}:${pad(min % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function draftError(d: EventDraft): string | null {
	if (d.title.trim().length < 1) return 'Give the event a title.';
	if (d.title.trim().length > TITLE_MAX) return `The title can be at most ${TITLE_MAX} characters.`;
	if (!d.calendarId) return 'Choose a calendar.';
	return null;
}

/** The JSON body for POST /api/calendar/events (wall times in the household zone). */
export function toRequest(d: EventDraft) {
	return {
		calendarId: d.calendarId,
		title: d.title.trim(),
		allDay: d.allDay,
		start: d.allDay ? d.date : `${d.date}T${clock(d.startMin)}`,
		end: d.allDay ? d.endDate : `${d.date}T${clock(d.endMin)}`,
		...(d.location.trim() ? { location: d.location.trim() } : {}),
		...(d.notes.trim() ? { notes: d.notes.trim() } : {})
	};
}

/** What the calendar shows while the server is still saving: same shape as a stored event. */
export function pendingEvent(d: EventDraft, tz: string, id: string): CalEvent {
	const base = {
		id,
		title: d.title.trim(),
		location: d.location.trim() || null,
		notes: d.notes.trim() || null,
		members: [],
		pending: true
	};
	if (d.allDay) {
		const utc = (k: DateKey) => Date.parse(`${k}T00:00:00Z`);
		return { ...base, allDay: true, startsAt: utc(d.date), endsAt: utc(addDays(d.endDate, 1)) };
	}
	return {
		...base,
		allDay: false,
		startsAt: zonedMs(d.date, d.startMin, tz),
		endsAt: zonedMs(d.date, d.endMin, tz)
	};
}

/** Whether a pending event belongs in the window [start, end). */
export function overlaps(ev: CalEvent, start: number, end: number): boolean {
	return ev.startsAt < end && Math.max(ev.endsAt, ev.startsAt + 1) > start;
}

/**
 * Whether the edit sheet can represent this event. Repeating events, timed events that cross
 * midnight and zero-length ones are left to the phone.
 */
export function editableInHub(ev: CalEvent, tz: string): boolean {
	if (ev.recurrence || ev.pending) return false;
	if (ev.allDay) return ev.endsAt > ev.startsAt;
	if (ev.endsAt <= ev.startsAt) return false;
	return (
		dateKeyOf(ev.startsAt, tz) === dateKeyOf(ev.endsAt - 1, tz) && endMinutes(ev, tz) <= LAST_END
	);
}

function endMinutes(ev: CalEvent, tz: string): number {
	return Math.round((ev.endsAt - dayStartMs(dateKeyOf(ev.startsAt, tz), tz)) / 60_000);
}

/** A draft pre-filled from a stored event, for the edit sheet. Call only if `editableInHub`. */
export function draftFromEvent(ev: CalEvent, tz: string): EventDraft {
	const base = {
		title: ev.title,
		location: ev.location ?? '',
		notes: ev.notes ?? '',
		calendarId: ev.sourceId ?? ''
	};
	if (ev.allDay) {
		const date = utcDateKey(ev.startsAt);
		return {
			...base,
			allDay: true,
			date,
			endDate: utcDateKey(ev.endsAt - 86_400_000),
			startMin: 9 * 60,
			endMin: 10 * 60
		};
	}
	const date = dateKeyOf(ev.startsAt, tz);
	const startMin = Math.round((ev.startsAt - dayStartMs(date, tz)) / 60_000);
	return { ...base, allDay: false, date, endDate: date, startMin, endMin: endMinutes(ev, tz) };
}
