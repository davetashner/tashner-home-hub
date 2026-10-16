import { getDb } from '#lib/server/db/index.js';
import { needsSetup } from '#lib/server/domain/setup.js';

/**
 * Cheap per-request check. Only "setup is done" is cached: once an adult holds a PIN the hub
 * never returns to first-run, so the cache cannot go stale. While setup is pending we re-query
 * (a count over a near-empty table).
 */
let done = false;

export function hubNeedsSetup(): boolean {
	if (done) return false;
	if (needsSetup(getDb())) return true;
	done = true;
	return false;
}

/** Marks setup complete right after the setup endpoint succeeds. */
export function markSetupDone(): void {
	done = true;
}
