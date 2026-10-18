import { addDays, dateKeyOf, dayStartMs, daysBetween, utcDateKey, type DateKey } from './zone.js';

export interface CalMember {
	id: string;
	name: string;
	color: string;
}

export interface CalEvent {
	id: string;
	title: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	members: CalMember[];
	/** Set while a hub-created event is still being saved to the provider. */
	pending?: boolean;
}

/** Minimum on-screen length of a timed event, so zero-length events stay tappable. */
export const MIN_MINUTES = 30;

/** First and last local day an event touches (inclusive). */
export function eventDays(ev: CalEvent, timeZone: string): { first: DateKey; last: DateKey } {
	if (ev.allDay) {
		// All-day events are stored as UTC midnights with an exclusive end.
		const first = utcDateKey(ev.startsAt);
		const last = addDays(utcDateKey(Math.max(ev.endsAt, ev.startsAt + 1)), -1);
		return { first, last: daysBetween(first, last) < 0 ? first : last };
	}
	const first = dateKeyOf(ev.startsAt, timeZone);
	const last = ev.endsAt > ev.startsAt ? dateKeyOf(ev.endsAt - 1, timeZone) : first;
	return { first, last };
}

/** Banner events render as day-spanning bars; others as timed blocks / chips. */
export function isBanner(ev: CalEvent): boolean {
	return ev.allDay || ev.endsAt - ev.startsAt >= 86_400_000;
}

const byStart = (a: CalEvent, b: CalEvent) =>
	Number(b.allDay) - Number(a.allDay) ||
	a.startsAt - b.startsAt ||
	a.endsAt - b.endsAt ||
	a.title.localeCompare(b.title);

/** Events grouped by every local day they touch, sorted all-day first then by start. */
export function bucketByDay(
	events: CalEvent[],
	keys: DateKey[],
	timeZone: string
): Map<DateKey, CalEvent[]> {
	const out = new Map<DateKey, CalEvent[]>(keys.map((k) => [k, []]));
	for (const ev of [...events].sort(byStart)) {
		const { first, last } = eventDays(ev, timeZone);
		for (const k of keys) if (k >= first && k <= last) out.get(k)!.push(ev);
	}
	return out;
}

export interface TimedSegment {
	event: CalEvent;
	startMin: number;
	endMin: number;
	lane: number;
	lanes: number;
}

/** Timed blocks for one day, clipped to the day, with side-by-side lanes for overlaps. */
export function timedSegments(events: CalEvent[], key: DateKey, timeZone: string): TimedSegment[] {
	const start = dayStartMs(key, timeZone);
	const end = dayStartMs(addDays(key, 1), timeZone);
	const segs = events
		.filter(
			(ev) => !isBanner(ev) && ev.startsAt < end && Math.max(ev.endsAt, ev.startsAt + 1) > start
		)
		.sort(byStart)
		.map((event) => {
			const startMin = Math.max(0, (event.startsAt - start) / 60_000);
			const rawEnd = Math.min(1440, (Math.min(event.endsAt, end) - start) / 60_000);
			return {
				event,
				startMin,
				endMin: Math.max(rawEnd, startMin + MIN_MINUTES),
				lane: 0,
				lanes: 1
			};
		});
	return assignLanes(segs);
}

/** Greedy lane packing; every cluster of transitively-overlapping segments shares a lane count. */
export function assignLanes<
	T extends { startMin: number; endMin: number; lane: number; lanes: number }
>(segs: T[]): T[] {
	let cluster: T[] = [];
	let clusterEnd = -1;
	let laneEnds: number[] = [];
	const flush = () => {
		for (const s of cluster) s.lanes = laneEnds.length;
		cluster = [];
		laneEnds = [];
	};
	for (const s of segs) {
		if (s.startMin >= clusterEnd) {
			flush();
			clusterEnd = -1;
		}
		let lane = laneEnds.findIndex((e) => e <= s.startMin);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = s.endMin;
		s.lane = lane;
		cluster.push(s);
		clusterEnd = Math.max(clusterEnd, s.endMin);
	}
	flush();
	return segs;
}

/** Hour range (start inclusive, end exclusive) the time grid should show for these segments. */
export function visibleHours(
	segments: TimedSegment[],
	min = { from: 7, to: 21 }
): { from: number; to: number } {
	let from = min.from;
	let to = min.to;
	for (const s of segments) {
		from = Math.min(from, Math.floor(s.startMin / 60));
		to = Math.max(to, Math.ceil(s.endMin / 60));
	}
	return { from, to };
}

export interface SpanBar {
	event: CalEvent;
	/** 0-based columns within the week, inclusive. */
	startCol: number;
	endCol: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

/** Day-spanning bars for one week row (all-day and 24h+ events), packed into lanes. */
export function spanBars(events: CalEvent[], weekKeys: DateKey[], timeZone: string): SpanBar[] {
	const bars: SpanBar[] = [];
	const lastCol = weekKeys.length - 1;
	for (const event of [...events].filter(isBanner).sort(byStart)) {
		const { first, last } = eventDays(event, timeZone);
		if (last < weekKeys[0] || first > weekKeys[lastCol]) continue;
		bars.push({
			event,
			startCol: Math.max(0, daysBetween(weekKeys[0], first)),
			endCol: Math.min(lastCol, daysBetween(weekKeys[0], last)),
			lane: 0,
			continuesBefore: first < weekKeys[0],
			continuesAfter: last > weekKeys[lastCol]
		});
	}
	bars.sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));
	const laneEnds: number[] = [];
	for (const bar of bars) {
		let lane = laneEnds.findIndex((e) => e < bar.startCol);
		if (lane === -1) lane = laneEnds.length;
		laneEnds[lane] = bar.endCol;
		bar.lane = lane;
	}
	return bars;
}
