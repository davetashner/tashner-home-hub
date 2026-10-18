/**
 * Family message board (requirements MSG-1): short sticky notes with an optional expiry.
 * Pure: "today" is the household zone's day, passed in, never the browser's or server's own.
 */

export const NOTE_MAX = 140;

/** Note color token names (`--color-note-*` in layout.css), in picker order. */
export const NOTE_COLORS = ['note-yellow', 'note-pink', 'note-blue', 'note-green'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const DEFAULT_NOTE_COLOR: NoteColor = 'note-yellow';

export const isNoteColor = (v: unknown): v is NoteColor =>
	typeof v === 'string' && (NOTE_COLORS as readonly string[]).includes(v);

export type Until = 'today' | 'tomorrow' | 'week';
export const UNTIL_CHOICES: readonly { id: Until; label: string }[] = [
	{ id: 'today', label: 'Today' },
	{ id: 'tomorrow', label: 'Tomorrow' },
	{ id: 'week', label: 'A week' }
];

export const isUntil = (v: unknown): v is Until =>
	v === 'today' || v === 'tomorrow' || v === 'week';

/** Whole days an `until` choice keeps a note: through the end of today, tomorrow, or 7 days on. */
const UNTIL_DAYS: Record<Until, number> = { today: 1, tomorrow: 2, week: 7 };

/** A drawing posted as a note: a PNG data URL. Kept under the 512 KB request limit once base64'd. */
export const NOTE_IMAGE_MAX_BYTES = 300_000;
const PNG_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The bytes of a small PNG data URL, or null when it is anything else. */
export function parseNoteImage(v: unknown): Uint8Array | null {
	if (typeof v !== 'string' || v.length > Math.ceil((NOTE_IMAGE_MAX_BYTES * 4) / 3) + 8)
		return null;
	const m = PNG_URL.exec(v);
	if (!m || m[1].length % 4 !== 0) return null;
	const bin = atob(m[1]);
	if (bin.length > NOTE_IMAGE_MAX_BYTES || bin.length <= PNG_SIGNATURE.length) return null;
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return PNG_SIGNATURE.every((b, i) => bytes[i] === b) ? bytes : null;
}

export interface NoteLike {
	id: string;
	pinned: boolean;
	createdAt: number;
	expiresAt: number | null;
}

/** Trimmed text, or null when empty or over the limit (counted in characters, not UTF-16 units). */
export function cleanNoteBody(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	const n = [...t].length;
	return n >= 1 && n <= NOTE_MAX ? t : null;
}

/** Offset of `zone` from UTC at an instant, in ms (positive east). */
function zoneOffset(zone: string, at: number): number {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		})
			.formatToParts(new Date(at))
			.map((x) => [x.type, Number(x.value)])
	);
	const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a local calendar day starts in `zone`. */
export function startOfDay(year: number, month: number, day: number, zone: string): number {
	const guess = Date.UTC(year, month - 1, day);
	let t = guess - zoneOffset(zone, guess);
	t = guess - zoneOffset(zone, t); // second pass settles a DST shift between guess and result
	return t;
}

/**
 * When a note with this `until` choice expires, as epoch ms: local midnight after today (today),
 * after tomorrow (tomorrow), or seven local days on (week). Null for no expiry.
 */
export function expiryFor(until: Until | null, now: number, zone: string): number | null {
	if (until === null) return null;
	const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
		timeZone: zone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	})
		.format(new Date(now))
		.split('-')
		.map(Number);
	// Date.UTC rolls month ends over, so day + N is always a real calendar day.
	const end = new Date(Date.UTC(y, m - 1, d + UNTIL_DAYS[until]));
	return startOfDay(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), zone);
}

export const isExpired = (n: Pick<NoteLike, 'expiresAt'>, now: number): boolean =>
	n.expiresAt !== null && n.expiresAt <= now;

/** Pinned first, then newest first; ties fall back to id so the order never flickers. */
export function compareNotes(a: NoteLike, b: NoteLike): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The notes still on the board at `now`, in display order. */
export function visibleNotes<T extends NoteLike>(notes: readonly T[], now: number): T[] {
	return notes.filter((n) => !isExpired(n, now)).sort(compareNotes);
}

/** "Until Tue" style hint for the card, or null when the note stays. */
export function untilLabel(expiresAt: number | null, now: number, zone: string): string | null {
	if (expiresAt === null) return null;
	const left = expiresAt - now;
	if (left <= 0) return null;
	const fmt = (at: number) =>
		new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(at));
	// The note vanishes at local midnight, so its last day is the minute before.
	return left <= 86_400_000 + 3_600_000 && fmt(expiresAt - 60_000) === fmt(now)
		? 'Until tonight'
		: `Until ${fmt(expiresAt - 60_000)}`;
}
