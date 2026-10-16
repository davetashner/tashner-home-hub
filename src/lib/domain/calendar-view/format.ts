import { eventDays, type CalEvent } from './layout.js';
import { addDays, dateKeyOf, type DateKey } from './zone.js';

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const id = timeZone + JSON.stringify(options);
	let f = cache.get(id);
	if (!f) cache.set(id, (f = new Intl.DateTimeFormat('en-US', { timeZone, ...options })));
	return f;
}

/** A calendar day key rendered with Intl. Keys are zone-less civil dates, so format in UTC. */
function keyFmt(key: DateKey, options: Intl.DateTimeFormatOptions): string {
	return fmt('UTC', options).format(new Date(`${key}T00:00:00Z`));
}

export const time = (ms: number, tz: string) =>
	fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms);

export const hourLabel = (hour: number) =>
	fmt('UTC', { hour: 'numeric' }).format(Date.UTC(2000, 0, 1, hour));

export const weekdayShort = (key: DateKey) => keyFmt(key, { weekday: 'short' });
export const dayNumber = (key: DateKey) => keyFmt(key, { day: 'numeric' });

/** "Today", "Tomorrow", else "Friday, October 17". */
export function dayHeading(key: DateKey, today: DateKey): { lead: string; rest: string } {
	const rest = keyFmt(key, { weekday: 'long', month: 'long', day: 'numeric' });
	if (key === today) return { lead: 'Today', rest };
	if (key === addDays(today, 1)) return { lead: 'Tomorrow', rest };
	return {
		lead: keyFmt(key, { weekday: 'long' }),
		rest: keyFmt(key, { month: 'long', day: 'numeric' })
	};
}

export function periodTitle(view: 'agenda' | 'week' | 'month', keys: DateKey[], anchor: DateKey) {
	if (view === 'month') return keyFmt(anchor, { month: 'long', year: 'numeric' });
	const a = keys[0];
	const b = keys[keys.length - 1];
	const sameMonth = a.slice(0, 7) === b.slice(0, 7);
	const left = keyFmt(a, { month: 'short', day: 'numeric' });
	const right = sameMonth
		? keyFmt(b, { day: 'numeric' })
		: keyFmt(b, { month: 'short', day: 'numeric' });
	return `${left} – ${right}, ${keyFmt(b, { year: 'numeric' })}`;
}

/** The time column text for an event as shown on `day`. */
export function dayTimeLabel(ev: CalEvent, day: DateKey, tz: string): string {
	if (ev.allDay) return 'All day';
	return eventDays(ev, tz).first < day ? `Until ${time(ev.endsAt, tz)}` : time(ev.startsAt, tz);
}

/** Full range for the details sheet. */
export function rangeLabel(ev: CalEvent, tz: string): string {
	const { first, last } = eventDays(ev, tz);
	const d = (k: DateKey) => keyFmt(k, { weekday: 'long', month: 'long', day: 'numeric' });
	if (ev.allDay)
		return first === last ? `${d(first)} · All day` : `${d(first)} – ${d(last)} · All day`;
	if (dateKeyOf(ev.startsAt, tz) === dateKeyOf(ev.endsAt, tz) || ev.endsAt <= ev.startsAt)
		return ev.endsAt <= ev.startsAt
			? `${d(first)} · ${time(ev.startsAt, tz)}`
			: `${d(first)} · ${time(ev.startsAt, tz)} – ${time(ev.endsAt, tz)}`;
	return `${d(first)} ${time(ev.startsAt, tz)} – ${d(last)} ${time(ev.endsAt, tz)}`;
}

/** "42 min ago", "3 hr ago", "2 days ago". */
export function ago(ms: number, now: number): string {
	const min = Math.max(0, Math.round((now - ms) / 60_000));
	if (min < 1) return 'just now';
	if (min < 60) return `${min} min ago`;
	if (min < 48 * 60) return `${Math.round(min / 60)} hr ago`;
	return `${Math.round(min / 1440)} days ago`;
}

/** "3p", "3:30p", "11a": compact time for month chips. */
export function shortTime(ms: number, tz: string): string {
	return time(ms, tz).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
}

/** CSS image for an event stripe: one member color, or equal bands for several. */
export function stripeColor(members: { color: string }[]): string {
	const colors = members.map((m) => `var(--color-${m.color})`);
	if (colors.length === 0) colors.push('var(--color-ink-muted)');
	if (colors.length === 1) return `linear-gradient(${colors[0]}, ${colors[0]})`;
	const step = 100 / colors.length;
	return `linear-gradient(to bottom, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}
