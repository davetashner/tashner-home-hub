/**
 * Appearance (hub-gj6.11, UI-5 and SLP-5): the household's theme (Light, Dark or Auto) and the
 * software evening dimming. Pure: no storage, no clock, no network.
 *
 * Auto is the night theme through "the evening": with a household location, from 45 minutes
 * after sunset to sunrise; without one, from a set evening time (default 19:00) to the morning
 * wake time of the sleep schedule. Times are household wall-clock times (DST-aware). Polar
 * night is all evening, polar day has none.
 * Dimming is a CSS brightness filter on the wall display only, in the same evening window.
 */
import {
	addDays,
	isWeekend,
	localYmd,
	zonedInstant,
	type SleepSchedule,
	type Ymd
} from './display-power.js';
import { sunTimes, type GeoPoint } from './sun.js';

export const APPEARANCE_KEY = 'display.appearance';

export const THEME_CHOICES = ['light', 'dark', 'auto'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export const THEME_LABELS: Record<ThemeChoice, string> = {
	light: 'Light',
	dark: 'Dark',
	auto: 'Auto'
};

export interface Appearance {
	theme: ThemeChoice;
	/** 24-hour "HH:MM" Auto turns dark when no location is set (12:00 to 23:59). */
	eveningStart: string;
	/** Evening brightness 0.5-1 for the wall display, or null for no dimming. */
	dim: number | null;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'auto', eveningStart: '19:00', dim: 0.8 };

export const DIM_MIN = 0.5;
export const DIM_MAX = 1;
/** Photos in the idle frame are never dimmed below this, whatever the setting. */
export const FRAME_DIM_FLOOR = 0.85;
/** Auto is dark from this long after sunset. */
export const SUNSET_DELAY_MS = 45 * 60_000;

const isEvening = (v: unknown): v is string =>
	typeof v === 'string' && /^(1[2-9]|2[0-3]):[0-5]\d$/.test(v);
const isDim = (v: unknown): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v >= DIM_MIN && v <= DIM_MAX;
const isTheme = (v: unknown): v is ThemeChoice => THEME_CHOICES.includes(v as ThemeChoice);

/** A stored value, field by field, falling back to the defaults for anything invalid. */
export function resolveAppearance(stored: unknown): Appearance {
	const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
	const d = DEFAULT_APPEARANCE;
	return {
		theme: isTheme(o.theme) ? o.theme : d.theme,
		eveningStart: isEvening(o.eveningStart) ? o.eveningStart : d.eveningStart,
		dim: o.dim === null ? null : isDim(o.dim) ? o.dim : d.dim
	};
}

export type AppearancePatch = Partial<Appearance>;

/** Validates a PUT body; returns the patch or an error message. Unknown fields are ignored. */
export function parseAppearancePatch(body: Record<string, unknown>): AppearancePatch | string {
	const patch: AppearancePatch = {};
	if (body.theme !== undefined) {
		if (!isTheme(body.theme)) return `theme must be one of ${THEME_CHOICES.join(', ')}`;
		patch.theme = body.theme;
	}
	if (body.eveningStart !== undefined) {
		if (!isEvening(body.eveningStart))
			return 'eveningStart must be a 24-hour time from 12:00 to 23:59';
		patch.eveningStart = body.eveningStart;
	}
	if (body.dim !== undefined) {
		if (body.dim !== null && !isDim(body.dim))
			return `dim must be null (off) or a number from ${DIM_MIN} to ${DIM_MAX}`;
		patch.dim = body.dim;
	}
	return patch;
}

export const applyAppearancePatch = (base: Appearance, patch: AppearancePatch): Appearance => ({
	...base,
	...patch
});

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Whether `now` falls in the evening-to-morning window (not the theme choice; just the clock). */
export function isEveningNow(
	now: number,
	zone: string,
	appearance: Pick<Appearance, 'eveningStart'>,
	schedule: SleepSchedule,
	location: GeoPoint | null
): boolean {
	const today = localYmd(zone, now);
	const sunOn = (d: Ymd) => (location ? sunTimes(location, d.y, d.m, d.d) : null);
	const polar = sunOn(today)?.polar;
	if (polar) return polar === 'night';
	const startOf = (d: Ymd) => {
		const sunset = sunOn(d)?.sunset;
		return typeof sunset === 'number'
			? sunset + SUNSET_DELAY_MS
			: zonedInstant(zone, d.y, d.m, d.d, minutesOf(appearance.eveningStart));
	};
	const endOf = (d: Ymd) => {
		const sunrise = sunOn(d)?.sunrise;
		if (typeof sunrise === 'number') return sunrise;
		const wake = (isWeekend(d) ? schedule.weekend : schedule.weekday).wake;
		return zonedInstant(zone, d.y, d.m, d.d, minutesOf(wake));
	};
	// Yesterday's evening runs into this morning; today's runs into tomorrow's.
	for (const back of [-1, 0]) {
		const day = addDays(today, back);
		if (startOf(day) <= now && now < endOf(addDays(day, 1))) return true;
	}
	return false;
}

/** The theme to show: a fixed choice, or night through the evening under Auto. */
export function themeFor(theme: ThemeChoice, evening: boolean): 'light' | 'night' {
	if (theme === 'auto') return evening ? 'night' : 'light';
	return theme === 'dark' ? 'night' : 'light';
}

/** The brightness multiplier (1 = none): wall displays only, in the evening; the idle frame keeps a floor. */
export function dimFactor(
	appearance: Pick<Appearance, 'dim'>,
	evening: boolean,
	wall: boolean,
	frame = false
): number {
	if (!wall || !evening || appearance.dim === null) return 1;
	return frame ? Math.max(appearance.dim, FRAME_DIM_FLOOR) : appearance.dim;
}

export interface AppearanceNow {
	theme: 'light' | 'night';
	dim: number;
}

/** Everything the shell needs for one minute: theme and dim factor. */
export function appearanceAt(
	now: number,
	zone: string,
	appearance: Appearance,
	schedule: SleepSchedule,
	location: GeoPoint | null,
	wall: boolean,
	frame = false
): AppearanceNow {
	const evening = isEveningNow(now, zone, appearance, schedule, location);
	return {
		theme: themeFor(appearance.theme, evening),
		dim: dimFactor(appearance, evening, wall, frame)
	};
}
