import type { KidGroup, Status } from './kid-chores.js';

const flat = (groups: KidGroup[]) => groups.flatMap((g) => g.chores);

/** Chores that moved from pending to approved between two reads of a child's board. */
export function approvedTransitions(
	before: KidGroup[] | undefined,
	after: KidGroup[]
): { count: number; stars: number } {
	const was = new Map<string, Status>((before ? flat(before) : []).map((c) => [c.id, c.status]));
	let count = 0;
	let stars = 0;
	for (const c of flat(after)) {
		if (c.status === 'approved' && was.get(c.id) === 'pending') {
			count += 1;
			stars += c.stars;
		}
	}
	return { count, stars };
}

/** True when the day has chores and every one is done (waiting for a grown-up counts). */
export function isAllDone(groups: KidGroup[]): boolean {
	const chores = flat(groups);
	return (
		chores.length > 0 && chores.every((c) => c.status === 'pending' || c.status === 'approved')
	);
}

/** localStorage key remembering the all-done party for one child on one day. */
export const allDoneKey = (memberId: string) => `hub.all-done.${memberId}`;

import { canonicalZone } from './time-zone.js';
import { DEFAULT_THEME, isSoundTheme, type SoundTheme } from './sound-themes.js';

export interface SoundSettings {
	muted: boolean;
	quietStart: string;
	quietEnd: string;
	theme: SoundTheme;
	/** 0 to 100. */
	volume: number;
	/** Household IANA zone the quiet hours are read in (set by the server; browser zone if absent). */
	timeZone?: string;
}

export const DEFAULT_SOUND: SoundSettings = {
	muted: false,
	quietStart: '20:00',
	quietEnd: '07:00',
	theme: DEFAULT_THEME,
	volume: 100
};

function minutes(hhmm: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Is `nowMinutes` (minutes since local midnight) inside the quiet window? Windows may wrap midnight. */
export function inQuietHours(nowMinutes: number, start: string, end: string): boolean {
	const s = minutes(start);
	const e = minutes(end);
	if (s === null || e === null || s === e) return false;
	return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

export function soundAllowed(settings: SoundSettings, nowMinutes: number): boolean {
	return (
		!settings.muted &&
		settings.volume > 0 &&
		!inQuietHours(nowMinutes, settings.quietStart, settings.quietEnd)
	);
}

/** Minutes since midnight at `nowMs` in `zone` (the runtime's own zone when absent or invalid). */
export function minutesInZone(nowMs: number, zone?: string): number {
	const tz = canonicalZone(zone) ?? undefined;
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(new Date(nowMs));
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
	return (get('hour') % 24) * 60 + get('minute');
}

/** Should a celebration make noise at `nowMs`? Not when muted or inside quiet hours (household zone). */
export function shouldPlaySound(settings: SoundSettings, nowMs: number): boolean {
	return soundAllowed(settings, minutesInZone(nowMs, settings.timeZone));
}

/** Coerces untrusted settings JSON into SoundSettings, falling back to defaults per field. */
export function parseSoundSettings(raw: unknown): SoundSettings {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const time = (v: unknown, d: string) => (typeof v === 'string' && minutes(v) !== null ? v : d);
	return {
		muted: o.muted === true,
		quietStart: time(o.quietStart, DEFAULT_SOUND.quietStart),
		quietEnd: time(o.quietEnd, DEFAULT_SOUND.quietEnd),
		theme: isSoundTheme(o.theme) ? o.theme : DEFAULT_THEME,
		volume:
			typeof o.volume === 'number' && Number.isFinite(o.volume)
				? Math.min(100, Math.max(0, Math.round(o.volume)))
				: DEFAULT_SOUND.volume,
		...(canonicalZone(o.timeZone) ? { timeZone: canonicalZone(o.timeZone)! } : {})
	};
}
