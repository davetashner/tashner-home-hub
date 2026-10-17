import { describe, expect, it } from 'vitest';
import type { CalEvent } from './calendar-view/layout.js';
import {
	DEFAULT_OVERLAY,
	eventsWindow,
	formatNextEvent,
	formatWeatherLine,
	isOverlayField,
	msToNextMinute,
	overlayNudge,
	overlayVisibility,
	parseOverlaySettings,
	pickNextEvent
} from './frame-overlay.js';

const TZ = 'America/Chicago';
// Friday 2026-10-16 3:00 PM CDT.
const NOW = Date.parse('2026-10-16T20:00:00Z');
const at = (iso: string) => Date.parse(iso);

function ev(id: string, over: Partial<CalEvent>): CalEvent {
	return {
		id,
		title: id,
		startsAt: NOW,
		endsAt: NOW + 3_600_000,
		allDay: false,
		location: null,
		notes: null,
		members: [],
		...over
	};
}

describe('settings', () => {
	it('defaults every overlay on and ignores junk', () => {
		expect(parseOverlaySettings(null)).toEqual(DEFAULT_OVERLAY);
		expect(parseOverlaySettings({ clock: 'no', date: false })).toEqual({
			clock: true,
			date: false,
			weather: true,
			nextEvent: true
		});
	});

	it('knows its fields', () => {
		expect(isOverlayField('weather')).toBe(true);
		expect(isOverlayField('sound')).toBe(false);
	});

	it('hides weather without a location and the layer when nothing shows', () => {
		expect(overlayVisibility(DEFAULT_OVERLAY, false)).toEqual({
			clock: true,
			date: true,
			weather: false,
			nextEvent: true,
			any: true
		});
		expect(overlayVisibility({ ...DEFAULT_OVERLAY, weather: false }, true).weather).toBe(false);
		const off = { clock: false, date: false, weather: false, nextEvent: false };
		expect(overlayVisibility(off, true).any).toBe(false);
		expect(overlayVisibility({ ...off, weather: true }, true).any).toBe(true);
	});
});

describe('pickNextEvent', () => {
	it('picks the soonest upcoming timed event today', () => {
		const later = ev('Swim practice', {
			startsAt: at('2026-10-16T21:30:00Z'),
			endsAt: at('2026-10-16T22:30:00Z')
		});
		const soon = ev('Piano', {
			startsAt: at('2026-10-16T20:30:00Z'),
			endsAt: at('2026-10-16T21:00:00Z')
		});
		expect(pickNextEvent([later, soon], NOW, TZ)).toEqual({
			id: 'Piano',
			title: 'Piano',
			day: 'today',
			at: '3:30 PM'
		});
	});

	it('skips events that already ended but keeps one in progress', () => {
		const over = ev('Done', {
			startsAt: at('2026-10-16T18:00:00Z'),
			endsAt: at('2026-10-16T19:00:00Z')
		});
		const going = ev('Going', {
			startsAt: at('2026-10-16T19:30:00Z'),
			endsAt: at('2026-10-16T21:00:00Z')
		});
		expect(pickNextEvent([over], NOW, TZ)).toBeNull();
		expect(pickNextEvent([over, going], NOW, TZ)?.id).toBe('Going');
	});

	it('treats a zero-length event as over once it starts', () => {
		const past = ev('Ping', {
			startsAt: at('2026-10-16T19:00:00Z'),
			endsAt: at('2026-10-16T19:00:00Z')
		});
		const future = ev('Pong', {
			startsAt: at('2026-10-16T22:00:00Z'),
			endsAt: at('2026-10-16T22:00:00Z')
		});
		expect(pickNextEvent([past], NOW, TZ)).toBeNull();
		expect(pickNextEvent([past, future], NOW, TZ)?.id).toBe('Pong');
	});

	it('prefers timed over all-day, and today over tomorrow', () => {
		const allDay = ev('Holiday', {
			allDay: true,
			startsAt: at('2026-10-16T00:00:00Z'),
			endsAt: at('2026-10-17T00:00:00Z')
		});
		const timed = ev('Dentist', {
			startsAt: at('2026-10-16T23:00:00Z'),
			endsAt: at('2026-10-17T00:00:00Z')
		});
		const tomorrow = ev('Early', {
			startsAt: at('2026-10-17T13:00:00Z'),
			endsAt: at('2026-10-17T14:00:00Z')
		});
		expect(pickNextEvent([allDay, timed, tomorrow], NOW, TZ)?.id).toBe('Dentist');
		expect(pickNextEvent([allDay, tomorrow], NOW, TZ)).toEqual({
			id: 'Holiday',
			title: 'Holiday',
			day: 'today',
			at: null
		});
		expect(pickNextEvent([tomorrow], NOW, TZ)).toEqual({
			id: 'Early',
			title: 'Early',
			day: 'tomorrow',
			at: '8:00 AM'
		});
	});

	it('uses the household zone for the day boundary', () => {
		// 11 PM Friday in Chicago is already Saturday in UTC; an 8 AM Saturday event is tomorrow.
		const lateNow = at('2026-10-17T04:00:00Z');
		const sat = ev('Soccer', {
			startsAt: at('2026-10-17T13:00:00Z'),
			endsAt: at('2026-10-17T14:00:00Z')
		});
		expect(pickNextEvent([sat], lateNow, TZ)?.day).toBe('tomorrow');
		expect(pickNextEvent([sat], lateNow, 'UTC')?.day).toBe('today');
	});

	it('ignores events beyond tomorrow and multi-day events that ended', () => {
		const far = ev('Far', {
			startsAt: at('2026-10-19T15:00:00Z'),
			endsAt: at('2026-10-19T16:00:00Z')
		});
		const old = ev('Trip', {
			allDay: true,
			startsAt: at('2026-10-12T00:00:00Z'),
			endsAt: at('2026-10-15T00:00:00Z')
		});
		expect(pickNextEvent([far, old], NOW, TZ)).toBeNull();
		expect(pickNextEvent([], NOW, TZ)).toBeNull();
	});

	it('shows a multi-day all-day event still running as today', () => {
		const trip = ev('Trip', {
			allDay: true,
			startsAt: at('2026-10-14T00:00:00Z'),
			endsAt: at('2026-10-18T00:00:00Z')
		});
		expect(pickNextEvent([trip], NOW, TZ)?.day).toBe('today');
	});
});

describe('formatting', () => {
	it('words today, tomorrow and all-day', () => {
		expect(formatNextEvent({ id: 'a', title: 'Swim practice', day: 'today', at: '4:30 PM' })).toBe(
			'Next: Swim practice · 4:30 PM'
		);
		expect(formatNextEvent({ id: 'a', title: 'Dentist', day: 'tomorrow', at: '9:00 AM' })).toBe(
			'Next: Dentist · Tomorrow 9:00 AM'
		);
		expect(formatNextEvent({ id: 'a', title: 'Holiday', day: 'today', at: null })).toBe(
			'Next: Holiday · All day'
		);
		expect(formatNextEvent({ id: 'a', title: 'Fair', day: 'tomorrow', at: null })).toBe(
			'Next: Fair · Tomorrow All day'
		);
	});

	it('formats the weather line', () => {
		expect(formatWeatherLine({ temp: 72, code: 0, isDay: true }, 'F')).toEqual({
			icon: '☀️',
			temp: '72°F',
			label: 'Clear'
		});
		expect(formatWeatherLine({ temp: -3, code: 0, isDay: false }, 'C')).toEqual({
			icon: '🌙',
			temp: '-3°C',
			label: 'Clear'
		});
	});

	it('asks for events through the end of tomorrow', () => {
		const w = eventsWindow(NOW, TZ);
		expect(w.start).toBe(NOW);
		expect(w.end).toBe(at('2026-10-18T05:00:00Z'));
	});
});

describe('timing', () => {
	it('aligns to the minute', () => {
		expect(msToNextMinute(120_000)).toBe(60_000);
		expect(msToNextMinute(150_500)).toBe(29_500);
	});

	it('drifts within bounds and holds still between steps', () => {
		expect(overlayNudge(0)).toEqual({ x: 0, y: 0 });
		expect(overlayNudge(60_000)).toEqual(overlayNudge(120_000));
		const seen = new Set<string>();
		for (let i = 0; i < 80; i++) {
			const n = overlayNudge(i * 300_000);
			expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
			seen.add(`${n.x},${n.y}`);
		}
		expect(seen.size).toBeGreaterThan(20);
	});
});
