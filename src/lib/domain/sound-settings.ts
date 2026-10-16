/**
 * Sound settings editing (hub-sps.9): strict HH:MM validation for the PUT, the quiet-hours
 * steppers and their labels. Pure so the settings page only wires buttons to these.
 */

/** Quiet-hours steppers move in quarter hours. */
export const QUIET_STEP_MINUTES = 15;

const DAY = 24 * 60;

/** Strict 24-hour "HH:MM" (two-digit hours), the only shape the PUT accepts. */
export function isHhmm(v: unknown): v is string {
	return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Minutes since midnight for a valid "HH:MM"; null otherwise. */
export function toMinutes(hhmm: string): number | null {
	if (!isHhmm(hhmm)) return null;
	return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
}

/** "HH:MM" for any minute count, wrapped into one day. */
export function fromMinutes(total: number): string {
	const m = ((Math.round(total) % DAY) + DAY) % DAY;
	const pad = (n: number) => `${n}`.padStart(2, '0');
	return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * One stepper tap: the next quarter hour up (`direction` 1) or down (-1), snapping an
 * off-grid time to the grid first and wrapping past midnight both ways.
 */
export function stepTime(hhmm: string, direction: 1 | -1, step = QUIET_STEP_MINUTES): string {
	const m = toMinutes(hhmm) ?? 0;
	const snapped = direction === 1 ? Math.floor(m / step) * step : Math.ceil(m / step) * step;
	return fromMinutes(snapped + direction * step);
}

/** "8:00 PM" style label for a valid "HH:MM"; the raw text otherwise. */
export function timeLabel(hhmm: string): string {
	const m = toMinutes(hhmm);
	if (m === null) return hhmm;
	const h = Math.floor(m / 60);
	const min = `${m % 60}`.padStart(2, '0');
	return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One sentence describing the quiet window, noting when it runs overnight. */
export function quietSummary(start: string, end: string): string {
	const s = toMinutes(start);
	const e = toMinutes(end);
	if (s === null || e === null || s === e) return 'No quiet hours: sounds can play any time.';
	const next = s > e ? ' the next morning' : '';
	return `No sounds from ${timeLabel(start)} until ${timeLabel(end)}${next}.`;
}

export interface SoundPatch {
	muted?: boolean;
	quietStart?: string;
	quietEnd?: string;
}

/** Validates a PUT body; returns the patch or an error message. Unknown fields are ignored. */
export function parseSoundPatch(body: Record<string, unknown>): SoundPatch | string {
	const patch: SoundPatch = {};
	if (body.muted !== undefined) {
		if (typeof body.muted !== 'boolean') return 'muted must be true or false';
		patch.muted = body.muted;
	}
	for (const field of ['quietStart', 'quietEnd'] as const) {
		const v = body[field];
		if (v === undefined) continue;
		if (!isHhmm(v)) return `${field} must be a 24-hour time like 20:00`;
		patch[field] = v;
	}
	return patch;
}
