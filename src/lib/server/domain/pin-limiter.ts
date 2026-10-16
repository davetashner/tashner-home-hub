/**
 * Brute-force protection for PIN entry. After 5 wrong attempts entry locks for 60 s,
 * doubling with every further failure, capped at 15 minutes. State is in memory
 * (single server process); a restart clears it.
 */
export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 15 * 60_000;

/** Lock duration applied right after the given cumulative failure count. */
export function lockoutMs(failures: number): number {
	if (failures < FREE_ATTEMPTS) return 0;
	const doublings = Math.min(failures - FREE_ATTEMPTS, 20);
	return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

interface Entry {
	failures: number;
	lockedUntil: number;
}

export class PinLimiter {
	private entries = new Map<string, Entry>();

	/** Milliseconds until another attempt is allowed (0 = allowed now). */
	remainingMs(key: string, now: number): number {
		const e = this.entries.get(key);
		return e ? Math.max(0, e.lockedUntil - now) : 0;
	}

	/** Records a wrong attempt and returns the lock now in force (0 if none). */
	recordFailure(key: string, now: number): number {
		const e = this.entries.get(key) ?? { failures: 0, lockedUntil: 0 };
		e.failures += 1;
		const lock = lockoutMs(e.failures);
		e.lockedUntil = lock > 0 ? now + lock : e.lockedUntil;
		this.entries.set(key, e);
		this.prune(now);
		return lock;
	}

	recordSuccess(key: string): void {
		this.entries.delete(key);
	}

	/** Drops idle entries (unlocked and untouched for the maximum lock) to bound memory. */
	private prune(now: number): void {
		if (this.entries.size < 1000) return;
		for (const [k, e] of this.entries) {
			if (e.lockedUntil + MAX_LOCK_MS < now) this.entries.delete(k);
		}
	}
}
