/**
 * Stars for the daily drawing prompt (hub-t27j.8). Posting a drawing made from today's prompt earns
 * the artist one star, once per kid per household day. Each earned day is a `drawing` ledger row
 * whose ref is the day (YYYY-MM-DD), so the streak is read from the ledger too. Pure: "today" is
 * passed in, always the household zone's day.
 */

export const DRAWING_STAR_REASON = 'drawing';
export const DRAWING_STAR_VALUE = 1;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for a YYYY-MM-DD string, or null when it is not a real calendar day. */
function dayNumber(date: unknown): number | null {
	if (typeof date !== 'string') return null;
	const m = DATE.exec(date);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = Date.UTC(y, mo - 1, d);
	const back = new Date(t);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
		return null;
	return t / 86_400_000;
}

/**
 * Consecutive days with a drawing star, counting back from today. A streak that last grew
 * yesterday is still alive (today is not over yet); older than that it is 0. Junk, duplicates and
 * future days are ignored.
 */
export function drawingStreak(dates: readonly unknown[], today: string): number {
	const now = dayNumber(today);
	if (now === null) return 0;
	const days = new Set<number>();
	for (const d of dates) {
		const n = dayNumber(d);
		if (n !== null && n <= now) days.add(n);
	}
	let day = days.has(now) ? now : now - 1;
	let streak = 0;
	while (days.has(day)) {
		streak++;
		day--;
	}
	return streak;
}

export interface StarInfo {
	streak: number;
	/** True when today's star is already earned. */
	earned: boolean;
}

/** The small line next to a name in "Who drew it?": the streak, and the star on offer. */
export function starHint(info: StarInfo | undefined, canEarn: boolean): string {
	if (!info) return '';
	const parts: string[] = [];
	if (info.streak > 0) parts.push(`${info.streak}-day streak`);
	if (canEarn && !info.earned) parts.push(`+${DRAWING_STAR_VALUE} star`);
	return parts.join(' · ');
}

/** Reads the `{ streaks }` of a GET response; anything malformed gives no entries. */
export function parseStarInfo(raw: unknown): Record<string, StarInfo> {
	const src = (raw as { streaks?: unknown } | null)?.streaks;
	const out: Record<string, StarInfo> = {};
	if (!src || typeof src !== 'object') return out;
	for (const [id, v] of Object.entries(src)) {
		const s = (v as { streak?: unknown; earned?: unknown } | null) ?? {};
		if (typeof s.streak === 'number' && Number.isInteger(s.streak) && s.streak >= 0)
			out[id] = { streak: s.streak, earned: s.earned === true };
	}
	return out;
}
