/**
 * Space Junk progress (hub-26w.3): best stars per level, kept per kid on this device.
 * Hub-26w.4 moves it to the server; only `loadProgress` and `saveProgress` change then.
 * The in-game stars are never hub stars and never touch the ledger.
 */
export type Progress = Record<string, number>;

const KEY = 'hub.space-junk.progress';

const clampStars = (n: unknown): number =>
	typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0;

/** Reads stored progress defensively; anything malformed is dropped. */
export function parseProgress(raw: unknown): Progress {
	const out: Progress = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [id, v] of Object.entries(raw)) {
		const s = clampStars(v);
		if (s > 0) out[id] = s;
	}
	return out;
}

/** Records a finished level; the best never goes down. Returns a new object. */
export function recordResult(p: Progress, levelId: string, stars: number): Progress {
	const s = clampStars(stars);
	if (s === 0) return { ...p };
	return { ...p, [levelId]: Math.max(p[levelId] ?? 0, s) };
}

/** Level 1 is open; every later level opens once the one before it has been won. */
export function isUnlocked(p: Progress, levelIds: readonly string[], index: number): boolean {
	if (index <= 0) return true;
	const prev = levelIds[index - 1];
	return prev !== undefined && (p[prev] ?? 0) > 0;
}

const storeKey = (memberId: string | null) => `${KEY}.${memberId ?? 'device'}`;

export function loadProgress(memberId: string | null): Progress {
	try {
		return parseProgress(JSON.parse(localStorage.getItem(storeKey(memberId)) ?? '{}'));
	} catch {
		return {};
	}
}

export function saveProgress(memberId: string | null, p: Progress): void {
	try {
		localStorage.setItem(storeKey(memberId), JSON.stringify(p));
	} catch {
		// Storage unavailable: progress lasts until the page closes.
	}
}
