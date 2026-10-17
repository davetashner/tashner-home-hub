/**
 * Photo-frame overlays (hub-gj6.12, PHO-7): which of clock, date, weather and next event show on
 * the idle frame, which event counts as "next", and the burn-in drift. Pure: no clock or storage.
 */
import { time } from './calendar-view/format.js';
import { eventDays, type CalEvent } from './calendar-view/layout.js';
import { addDays, dateKeyOf, dayStartMs } from './calendar-view/zone.js';
import { describeWeather, unitSymbol, type WeatherCurrent, type WeatherUnit } from './weather.js';

export const OVERLAY_FIELDS = ['clock', 'date', 'weather', 'nextEvent'] as const;
export type OverlayField = (typeof OVERLAY_FIELDS)[number];
export type OverlaySettings = Record<OverlayField, boolean>;

export const DEFAULT_OVERLAY: OverlaySettings = {
	clock: true,
	date: true,
	weather: true,
	nextEvent: true
};

/** Weather refreshes this often while the frame shows. */
export const WEATHER_REFRESH_MS = 10 * 60_000;
/** Events refresh this often while the frame shows. */
export const EVENTS_REFRESH_MS = 5 * 60_000;
/** The overlay moves to a new spot this often. */
export const NUDGE_STEP_MS = 5 * 60_000;

export const isOverlayField = (v: unknown): v is OverlayField =>
	(OVERLAY_FIELDS as readonly unknown[]).includes(v);

/** Stored or fetched settings; each missing or non-boolean field stays on. */
export function parseOverlaySettings(raw: unknown): OverlaySettings {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const pick = (f: OverlayField) => (typeof o[f] === 'boolean' ? o[f] : DEFAULT_OVERLAY[f]);
	return {
		clock: pick('clock'),
		date: pick('date'),
		weather: pick('weather'),
		nextEvent: pick('nextEvent')
	};
}

/** What to draw: weather also needs a saved location, and the layer is off when nothing shows. */
export function overlayVisibility(settings: OverlaySettings, weatherEnabled: boolean) {
	const v = {
		clock: settings.clock,
		date: settings.date,
		weather: settings.weather && weatherEnabled,
		nextEvent: settings.nextEvent
	};
	return { ...v, any: v.clock || v.date || v.weather || v.nextEvent };
}

export interface NextEvent {
	id: string;
	title: string;
	day: 'today' | 'tomorrow';
	/** "4:30 PM", or null for an all-day event. */
	at: string | null;
}

/**
 * The next thing on the calendar today or tomorrow in the household zone. Events that already
 * ended are skipped; today comes before tomorrow, timed before all-day within a day, then by
 * start. Returns null when nothing is left.
 */
export function pickNextEvent(events: CalEvent[], now: number, timeZone: string): NextEvent | null {
	const today = dateKeyOf(now, timeZone);
	const tomorrow = addDays(today, 1);
	let best: { ev: CalEvent; day: 'today' | 'tomorrow'; rank: [number, number, number] } | null =
		null;
	for (const ev of events) {
		// A zero-length event is over once its start has passed.
		const over = ev.endsAt > ev.startsAt ? ev.endsAt <= now : ev.startsAt < now;
		if (!ev.allDay && over) continue;
		const { first, last } = eventDays(ev, timeZone);
		// A multi-day event that began earlier is "today" while it still covers today.
		const covers = (k: string) => first <= k && k <= last;
		const day = covers(today) ? 'today' : covers(tomorrow) ? 'tomorrow' : null;
		if (!day) continue;
		const rank: [number, number, number] = [
			day === 'today' ? 0 : 1,
			ev.allDay ? 1 : 0,
			ev.startsAt
		];
		if (!best || compare(rank, best.rank) < 0) best = { ev, day, rank };
	}
	if (!best) return null;
	const { ev, day } = best;
	return { id: ev.id, title: ev.title, day, at: ev.allDay ? null : time(ev.startsAt, timeZone) };
}

function compare(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

/** "Next: Swim practice · 4:30 PM", "Next: Dentist · Tomorrow 9:00 AM", "Next: Holiday · All day". */
export function formatNextEvent(next: NextEvent): string {
	const when = next.at ?? 'All day';
	return `Next: ${next.title} · ${next.day === 'tomorrow' ? `Tomorrow ${when}` : when}`;
}

/** The calendar window to ask for: now until the end of tomorrow. */
export function eventsWindow(now: number, timeZone: string): { start: number; end: number } {
	return { start: now, end: dayStartMs(addDays(dateKeyOf(now, timeZone), 2), timeZone) };
}

/** "☀️ 72°F Clear". */
export function formatWeatherLine(
	current: Pick<WeatherCurrent, 'temp' | 'code' | 'isDay'>,
	unit: WeatherUnit
) {
	const c = describeWeather(current.code, current.isDay);
	return { icon: c.icon, temp: `${current.temp}${unitSymbol(unit)}`, label: c.label };
}

/**
 * Burn-in drift: a spot in -1..1 on each axis that changes every few minutes (two incommensurate
 * periods, so it does not retrace quickly). The layer moves with transform only.
 */
export function overlayNudge(now: number): { x: number; y: number } {
	const step = Math.floor(now / NUDGE_STEP_MS);
	const round = (n: number) => Math.round(n * 100) / 100;
	return {
		x: round(Math.sin((2 * Math.PI * step) / 11)),
		y: round(Math.sin((2 * Math.PI * step) / 7))
	};
}

/** Ms until the next whole minute, so the clock ticks once a minute right on the change. */
export const msToNextMinute = (now: number): number => 60_000 - (now % 60_000);
