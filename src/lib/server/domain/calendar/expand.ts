import * as rruleNs from 'rrule';
import type { Options } from 'rrule';
import {
	DAY,
	fromWall,
	isAllDay,
	isoDate,
	parseDate,
	parseWall,
	toInstant,
	toWall
} from './time.js';
import type { Instance, RemoteEvent, RemoteTime, Window } from './types.js';

/** rrule is CommonJS: under Node's native ESM loader the classes live on `default`. */
const { RRule } = ((rruleNs as { default?: typeof rruleNs }).default ?? rruleNs) as typeof rruleNs;

/** Hard cap per event so a runaway rule cannot flood the database. */
const MAX_INSTANCES = 1000;

function instanceKey(t: RemoteTime): string {
	return isAllDay(t) ? t.date : new Date(toInstant(t)).toISOString();
}

export function externalIdFor(uid: string, start: RemoteTime): string {
	return `${uid}::${instanceKey(start)}`;
}

function overlaps(start: number, end: number, w: Window): boolean {
	return end > start ? start < w.end && end > w.start : start >= w.start && start < w.end;
}

function build(
	ev: RemoteEvent,
	key: string,
	startsAt: number,
	endsAt: number,
	allDay: boolean
): Instance {
	return {
		externalId: `${ev.uid}::${key}`,
		title: ev.title,
		startsAt,
		endsAt,
		allDay,
		recurrence: ev.rrule ?? null,
		location: ev.location ?? null,
		notes: ev.notes ?? null
	};
}

/** Duration of one occurrence: whole days for all-day events, milliseconds otherwise. */
function durationOf(ev: RemoteEvent): number {
	const s = toInstant(ev.start);
	if (ev.end) return Math.max(0, toInstant(ev.end) - s);
	return isAllDay(ev.start) ? DAY : 0;
}

function single(ev: RemoteEvent, key: RemoteTime, w: Window): Instance[] {
	const startsAt = toInstant(ev.start);
	const inst = build(ev, instanceKey(key), startsAt, startsAt + durationOf(ev), isAllDay(ev.start));
	return overlaps(inst.startsAt, inst.endsAt, w) ? [inst] : [];
}

/** Wall-clock rule evaluation: rrule runs on "fake UTC" so local times survive DST. */
function wallOccurrences(master: RemoteEvent, w: Window): number[] {
	const allDay = isAllDay(master.start);
	const tz = isAllDay(master.start) ? 'UTC' : master.start.timeZone;
	const dtstart = allDay
		? parseDate((master.start as { date: string }).date)
		: parseWall((master.start as { dateTime: string }).dateTime);
	const set = new Set<number>();
	if (master.rrule) {
		const opts: Partial<Options> = RRule.parseString(master.rrule);
		if (opts.until && !allDay) opts.until = new Date(toWall(opts.until.getTime(), tz));
		const rule = new RRule({ ...opts, dtstart: new Date(dtstart) });
		// Pad the window by a day each side: zone offsets shift wall time by < 1 day.
		for (const t of rule.between(new Date(w.start - DAY), new Date(w.end + DAY), true))
			set.add(t.getTime());
	} else {
		set.add(dtstart); // RDATE-only: the start itself is the first occurrence
	}
	for (const r of master.rdates ?? [])
		set.add(isAllDay(r) ? parseDate(r.date) : parseWall(r.dateTime));
	const ex = new Set(
		(master.exdates ?? []).map((x) => (isAllDay(x) ? parseDate(x.date) : parseWall(x.dateTime)))
	);
	return [...set]
		.filter((x) => !ex.has(x))
		.sort((a, b) => a - b)
		.slice(0, MAX_INSTANCES);
}

/**
 * Expands one UID's events (a master plus any recurrence-id overrides) into the concrete
 * instances that overlap `w`. Cancelled masters/instances produce nothing.
 */
export function expandEvent(events: RemoteEvent[], w: Window): Instance[] {
	const overrides = events.filter((e) => e.recurrenceId);
	const master = events.find((e) => !e.recurrenceId);
	const out: Instance[] = [];
	const overridden = new Set(overrides.map((o) => instanceKey(o.recurrenceId!)));

	if (master && master.status !== 'cancelled') {
		if (!master.rrule && !master.rdates?.length) {
			out.push(...single(master, master.start, w));
		} else {
			const allDay = isAllDay(master.start);
			const tz = isAllDay(master.start) ? 'UTC' : master.start.timeZone;
			const dur = durationOf(master);
			for (const wall of wallOccurrences(master, w)) {
				const startsAt = allDay ? wall : fromWall(wall, tz);
				const key = allDay ? isoDate(wall) : new Date(startsAt).toISOString();
				if (overridden.has(key)) continue;
				if (overlaps(startsAt, startsAt + dur, w))
					out.push(build(master, key, startsAt, startsAt + dur, allDay));
			}
		}
	}

	for (const o of overrides) {
		if (o.status === 'cancelled') continue;
		const startsAt = toInstant(o.start);
		const inst = build(
			o,
			instanceKey(o.recurrenceId!),
			startsAt,
			startsAt + durationOf(o),
			isAllDay(o.start)
		);
		inst.recurrence = master?.rrule ?? null;
		if (overlaps(inst.startsAt, inst.endsAt, w)) out.push(inst);
	}
	return out.sort((a, b) => a.startsAt - b.startsAt || a.externalId.localeCompare(b.externalId));
}

/** Groups remote events by UID and expands them all. */
export function expandAll(events: RemoteEvent[], w: Window): Instance[] {
	const byUid = new Map<string, RemoteEvent[]>();
	for (const e of events) byUid.set(e.uid, [...(byUid.get(e.uid) ?? []), e]);
	const seen = new Map<string, Instance>();
	for (const group of byUid.values())
		for (const i of expandEvent(group, w)) seen.set(i.externalId, i);
	return [...seen.values()];
}
