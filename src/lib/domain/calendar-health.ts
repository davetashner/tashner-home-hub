/** Same threshold the server uses to flag a calendar as stale (sync.ts). */
export const STALE_AFTER_MS = 30 * 60_000;

export type HealthKind = 'ok' | 'stale' | 'reauth' | 'error' | 'new';
export type HealthTone = 'success' | 'neutral' | 'star' | 'danger';

export interface HealthInput {
	needsReauth: boolean;
	lastError: string | null;
	lastSyncAt: number | null;
}

export interface Health {
	kind: HealthKind;
	chip: string;
	tone: HealthTone;
	/** One calm sentence a non-technical parent can act on. */
	text: string;
}

/** "just now", "5 min ago", "2 hours ago", "3 days ago". */
export function relativeTime(at: number | null, now: number): string {
	if (at === null) return 'never';
	const mins = Math.floor(Math.max(0, now - at) / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
	const days = Math.floor(hours / 24);
	return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Re-auth wins over a plain error, which wins over staleness. */
export function classifyHealth(s: HealthInput, now: number): Health {
	if (s.needsReauth)
		return {
			kind: 'reauth',
			chip: 'Needs reconnect',
			tone: 'danger',
			text: 'The sign-in stopped working. Reconnect to keep events coming.'
		};
	if (s.lastError)
		return {
			kind: 'error',
			chip: 'Error',
			tone: 'danger',
			text: 'The last check hit a snag. It will try again on its own, or tap Sync now.'
		};
	if (s.lastSyncAt === null)
		return {
			kind: 'new',
			chip: 'Waiting',
			tone: 'neutral',
			text: 'Not checked yet. Tap Sync now.'
		};
	if (now - s.lastSyncAt > STALE_AFTER_MS)
		return {
			kind: 'stale',
			chip: 'Stale',
			tone: 'star',
			text: `Last updated ${relativeTime(s.lastSyncAt, now)}.`
		};
	return {
		kind: 'ok',
		chip: 'OK',
		tone: 'success',
		text: `Updated ${relativeTime(s.lastSyncAt, now)}.`
	};
}

export const PROVIDER_NAMES = { google: 'Google', icloud: 'iCloud', ics: 'Link' } as const;

/** "Mom's Google calendar needs reconnecting." */
export const reconnectMessage = (label: string): string => `${label} calendar needs reconnecting.`;

/** Whether the pasted text could plausibly be Google's redirect address (or the bare code). */
export function looksLikeGoogleAddress(text: string): boolean {
	const t = text.trim();
	return /[?&]code=[^&\s]+/.test(t) || (t.length > 20 && !/\s/.test(t) && !t.includes('://'));
}
