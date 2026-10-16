import { describe, expect, it } from 'vitest';
import {
	ago,
	shortTime,
	stripeColor,
	dayHeading,
	dayTimeLabel,
	hourLabel,
	periodTitle,
	rangeLabel,
	time,
	weekdayShort,
	dayNumber
} from './format.js';
import {
	assignLanes,
	bucketByDay,
	eventDays,
	isBanner,
	spanBars,
	timedSegments,
	visibleHours,
	type CalEvent
} from './layout.js';
import { fetchRange, isViewMode, periodKeys, shiftAnchor } from './period.js';
import {
	addDays,
	addMonths,
	dateKeyOf,
	dayStartMs,
	daysBetween,
	firstOfMonth,
	offsetAt,
	range,
	sameMonth,
	startOfWeek,
	utcDateKey,
	weekday,
	zonedMs
} from './zone.js';

const NY = 'America/New_York';
let n = 0;
function ev(over: Partial<CalEvent> & { start: string; end?: string; tz?: string }): CalEvent {
	const { start, end, tz = NY, ...rest } = over;
	const ms = (s: string) =>
		zonedMs(s.slice(0, 10), Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)), tz);
	const startsAt = ms(start);
	return {
		id: `e${n++}`,
		title: 'Event',
		startsAt,
		endsAt: end ? ms(end) : startsAt,
		allDay: false,
		location: null,
		notes: null,
		members: [],
		...rest
	};
}
const allDay = (first: string, lastInclusive: string, title = 'Holiday'): CalEvent => ({
	id: `a${n++}`,
	title,
	startsAt: Date.parse(`${first}T00:00:00Z`),
	endsAt: Date.parse(`${addDays(lastInclusive, 1)}T00:00:00Z`),
	allDay: true,
	location: null,
	notes: null,
	members: []
});

describe('zone math', () => {
	it('computes offsets and day keys across zones', () => {
		expect(offsetAt(Date.UTC(2026, 0, 15, 12), NY)).toBe(-5 * 3_600_000);
		expect(offsetAt(Date.UTC(2026, 6, 15, 12), NY)).toBe(-4 * 3_600_000);
		expect(dateKeyOf(Date.UTC(2026, 9, 15, 3, 30), NY)).toBe('2026-10-14');
		expect(dateKeyOf(Date.UTC(2026, 9, 15, 3, 30), 'Asia/Tokyo')).toBe('2026-10-15');
		expect(utcDateKey(Date.UTC(2026, 9, 15))).toBe('2026-10-15');
	});

	it('keeps day boundaries correct on DST days', () => {
		const spring = dayStartMs('2026-03-08', NY);
		expect(dayStartMs('2026-03-09', NY) - spring).toBe(23 * 3_600_000);
		const fall = dayStartMs('2026-11-01', NY);
		expect(dayStartMs('2026-11-02', NY) - fall).toBe(25 * 3_600_000);
		expect(dateKeyOf(dayStartMs('2026-03-08', NY), NY)).toBe('2026-03-08');
		expect(dateKeyOf(dayStartMs('2026-03-08', NY) - 1, NY)).toBe('2026-03-07');
		// 3:00 local after the spring gap is 2h of wall clock after midnight in real time.
		expect(zonedMs('2026-03-08', 180, NY) - spring).toBe(2 * 3_600_000);
	});

	it('does date arithmetic on civil keys', () => {
		expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
		expect(addDays('2026-01-02', -3)).toBe('2025-12-30');
		expect(daysBetween('2026-10-15', '2026-10-20')).toBe(5);
		expect(weekday('2026-10-15')).toBe(4);
		expect(startOfWeek('2026-10-15')).toBe('2026-10-11');
		expect(startOfWeek('2026-10-11')).toBe('2026-10-11');
		expect(startOfWeek('2026-10-15', 1)).toBe('2026-10-12');
		expect(firstOfMonth('2026-10-15')).toBe('2026-10-01');
		expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
		expect(sameMonth('2026-10-01', '2026-10-31')).toBe(true);
		expect(range('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
	});
});

describe('eventDays and buckets', () => {
	it('maps all-day events by their UTC dates (exclusive end)', () => {
		expect(eventDays(allDay('2026-10-14', '2026-10-14'), NY)).toEqual({
			first: '2026-10-14',
			last: '2026-10-14'
		});
		expect(eventDays(allDay('2026-10-14', '2026-10-16'), 'Pacific/Auckland')).toEqual({
			first: '2026-10-14',
			last: '2026-10-16'
		});
		const zero = {
			...allDay('2026-10-14', '2026-10-14'),
			endsAt: Date.parse('2026-10-14T00:00:00Z')
		};
		expect(eventDays(zero, NY)).toEqual({ first: '2026-10-14', last: '2026-10-14' });
	});

	it('treats timed events by local day, including crossing midnight and zero length', () => {
		const sleepover = ev({ start: '2026-10-16T20:00', end: '2026-10-17T10:00' });
		expect(eventDays(sleepover, NY)).toEqual({ first: '2026-10-16', last: '2026-10-17' });
		expect(isBanner(sleepover)).toBe(false);
		const ends = ev({ start: '2026-10-16T20:00', end: '2026-10-17T00:00' });
		expect(eventDays(ends, NY).last).toBe('2026-10-16');
		expect(eventDays(ev({ start: '2026-10-16T09:00' }), NY).last).toBe('2026-10-16');
		expect(isBanner(ev({ start: '2026-10-16T09:00', end: '2026-10-18T09:00' }))).toBe(true);
	});

	it('buckets multi-day events into each day, all-day first', () => {
		const trip = allDay('2026-10-15', '2026-10-17', 'Trip');
		const dentist = ev({ start: '2026-10-16T09:00', end: '2026-10-16T10:00', title: 'Dentist' });
		const early = ev({ start: '2026-10-16T08:00', end: '2026-10-16T08:30', title: 'Early' });
		const out = bucketByDay([dentist, early, trip], range('2026-10-14', 5), NY);
		expect(out.get('2026-10-14')).toEqual([]);
		expect(out.get('2026-10-15')!.map((e) => e.title)).toEqual(['Trip']);
		expect(out.get('2026-10-16')!.map((e) => e.title)).toEqual(['Trip', 'Early', 'Dentist']);
		expect(out.get('2026-10-18')).toEqual([]);
	});
});

describe('timed segments and lanes', () => {
	it('clips cross-midnight events to each day', () => {
		const e = ev({ start: '2026-10-16T22:00', end: '2026-10-17T01:00' });
		const a = timedSegments([e], '2026-10-16', NY)[0];
		const b = timedSegments([e], '2026-10-17', NY)[0];
		expect([a.startMin, a.endMin]).toEqual([1320, 1440]);
		expect([b.startMin, b.endMin]).toEqual([0, 60]);
		expect(timedSegments([e], '2026-10-18', NY)).toEqual([]);
	});

	it('gives zero-length events a minimum height and skips banners', () => {
		const dot = ev({ start: '2026-10-16T09:00' });
		const [s] = timedSegments([dot, allDay('2026-10-16', '2026-10-16')], '2026-10-16', NY);
		expect(s.endMin - s.startMin).toBe(30);
	});

	it('places overlapping events side by side', () => {
		const a = ev({ start: '2026-10-16T09:00', end: '2026-10-16T11:00' });
		const b = ev({ start: '2026-10-16T10:00', end: '2026-10-16T12:00' });
		const c = ev({ start: '2026-10-16T10:30', end: '2026-10-16T11:00' });
		const d = ev({ start: '2026-10-16T15:00', end: '2026-10-16T16:00' });
		const segs = timedSegments([d, c, b, a], '2026-10-16', NY);
		const by = (x: CalEvent) => segs.find((s) => s.event === x)!;
		expect([by(a).lane, by(b).lane, by(c).lane]).toEqual([0, 1, 2]);
		expect([by(a).lanes, by(b).lanes, by(c).lanes]).toEqual([3, 3, 3]);
		expect([by(d).lane, by(d).lanes]).toEqual([0, 1]);
	});

	it('reuses a freed lane', () => {
		const segs = assignLanes([
			{ startMin: 0, endMin: 60, lane: 0, lanes: 1 },
			{ startMin: 30, endMin: 120, lane: 0, lanes: 1 },
			{ startMin: 70, endMin: 100, lane: 0, lanes: 1 }
		]);
		expect(segs.map((s) => s.lane)).toEqual([0, 1, 0]);
		expect(segs.every((s) => s.lanes === 2)).toBe(true);
	});

	it('widens the visible hours to fit events', () => {
		expect(visibleHours([])).toEqual({ from: 7, to: 21 });
		const e = ev({ start: '2026-10-16T05:30', end: '2026-10-16T22:15' });
		expect(visibleHours(timedSegments([e], '2026-10-16', NY))).toEqual({ from: 5, to: 23 });
	});
});

describe('spanBars', () => {
	const week = range('2026-10-11', 7);
	it('lays out multi-day bars with continuation flags and lanes', () => {
		const grandma = allDay('2026-10-13', '2026-10-15', 'Grandma');
		const holiday = allDay('2026-10-14', '2026-10-14', 'Holiday');
		const long = allDay('2026-10-08', '2026-10-12', 'Long');
		const next = allDay('2026-10-17', '2026-10-19', 'Next');
		const outside = allDay('2026-10-20', '2026-10-21', 'Outside');
		const bars = spanBars(
			[holiday, next, grandma, long, outside, ev({ start: '2026-10-13T09:00' })],
			week,
			NY
		);
		const get = (t: string) => bars.find((b) => b.event.title === t)!;
		expect(bars).toHaveLength(4);
		expect(get('Long')).toMatchObject({
			startCol: 0,
			endCol: 1,
			continuesBefore: true,
			continuesAfter: false,
			lane: 0
		});
		expect(get('Grandma')).toMatchObject({ startCol: 2, endCol: 4, lane: 0 });
		expect(get('Holiday')).toMatchObject({ startCol: 3, endCol: 3, lane: 1 });
		expect(get('Next')).toMatchObject({ startCol: 6, endCol: 6, continuesAfter: true });
	});
});

describe('periods', () => {
	it('computes keys per view', () => {
		expect(periodKeys('agenda', '2026-10-15')).toHaveLength(7);
		expect(periodKeys('week', '2026-10-15')[0]).toBe('2026-10-11');
		const month = periodKeys('month', '2026-10-15');
		expect(month[0]).toBe('2026-09-27');
		expect(month).toHaveLength(35);
		expect(periodKeys('month', '2026-11-03')).toHaveLength(35);
		expect(periodKeys('month', '2026-03-03')).toHaveLength(35);
		expect(periodKeys('month', '2026-08-03')).toHaveLength(42);
	});

	it('shifts anchors and pads the fetch range', () => {
		expect(shiftAnchor('week', '2026-10-15', 1)).toBe('2026-10-22');
		expect(shiftAnchor('agenda', '2026-10-15', -1)).toBe('2026-10-08');
		expect(shiftAnchor('month', '2026-10-15', 1)).toBe('2026-11-01');
		const keys = periodKeys('week', '2026-10-15');
		const r = fetchRange(keys, NY);
		expect(r.start).toBe(dayStartMs('2026-10-10', NY));
		expect(r.end).toBe(dayStartMs('2026-10-19', NY));
		expect(isViewMode('week')).toBe(true);
		expect(isViewMode('year')).toBe(false);
	});
});

describe('formatting', () => {
	it('formats times in the zone', () => {
		const e = ev({ start: '2026-10-16T15:05', end: '2026-10-16T16:00' });
		expect(time(e.startsAt, NY)).toBe('3:05 PM');
		expect(hourLabel(9)).toBe('9 AM');
		expect(weekdayShort('2026-10-15')).toBe('Thu');
		expect(dayNumber('2026-10-05')).toBe('5');
	});

	it('labels days and periods', () => {
		expect(dayHeading('2026-10-15', '2026-10-15').lead).toBe('Today');
		expect(dayHeading('2026-10-16', '2026-10-15').lead).toBe('Tomorrow');
		expect(dayHeading('2026-10-17', '2026-10-15')).toEqual({
			lead: 'Saturday',
			rest: 'October 17'
		});
		expect(periodTitle('month', periodKeys('month', '2026-10-15'), '2026-10-15')).toBe(
			'October 2026'
		);
		expect(periodTitle('week', range('2026-10-11', 7), '2026-10-15')).toBe('Oct 11 – 17, 2026');
		expect(periodTitle('week', range('2026-10-28', 7), '2026-10-28')).toBe('Oct 28 – Nov 3, 2026');
	});

	it('labels event times per day and as a range', () => {
		const timed = ev({ start: '2026-10-16T09:00', end: '2026-10-16T10:30' });
		const over = ev({ start: '2026-10-16T20:00', end: '2026-10-17T10:00' });
		expect(dayTimeLabel(allDay('2026-10-16', '2026-10-16'), '2026-10-16', NY)).toBe('All day');
		expect(dayTimeLabel(timed, '2026-10-16', NY)).toBe('9:00 AM');
		expect(dayTimeLabel(over, '2026-10-17', NY)).toBe('Until 10:00 AM');
		expect(rangeLabel(timed, NY)).toBe('Friday, October 16 · 9:00 AM – 10:30 AM');
		expect(rangeLabel(ev({ start: '2026-10-16T09:00' }), NY)).toBe('Friday, October 16 · 9:00 AM');
		expect(rangeLabel(over, NY)).toBe('Friday, October 16 8:00 PM – Saturday, October 17 10:00 AM');
		expect(rangeLabel(allDay('2026-10-16', '2026-10-16'), NY)).toBe('Friday, October 16 · All day');
		expect(rangeLabel(allDay('2026-10-16', '2026-10-18'), NY)).toBe(
			'Friday, October 16 – Sunday, October 18 · All day'
		);
	});

	it('compacts times and builds stripes', () => {
		expect(shortTime(zonedMs('2026-10-16', 15 * 60, NY), NY)).toBe('3p');
		expect(shortTime(zonedMs('2026-10-16', 11 * 60 + 30, NY), NY)).toBe('11:30a');
		expect(stripeColor([])).toContain('ink-muted');
		expect(stripeColor([{ color: 'member-1' }])).toBe(
			'linear-gradient(var(--color-member-1), var(--color-member-1))'
		);
		expect(stripeColor([{ color: 'member-1' }, { color: 'member-2' }])).toContain('50%');
	});

	it('words elapsed time', () => {
		expect(ago(0, 20_000)).toBe('just now');
		expect(ago(0, 42 * 60_000)).toBe('42 min ago');
		expect(ago(0, 3 * 3_600_000)).toBe('3 hr ago');
		expect(ago(0, 3 * 86_400_000)).toBe('3 days ago');
	});
});
