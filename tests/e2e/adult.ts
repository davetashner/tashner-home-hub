import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPin } from '../../src/lib/server/domain/pin';
import { sweepPrevious } from './cleanup';
import { DATA_DIR, DB_PATH } from './data-dir';

export const PIN = '4817';

/** Seeds a synthetic adult straight into the server's SQLite file, then unlocks this page's session as them. */
export async function signInAsAdult(page: Page, id: string): Promise<void> {
	mkdirSync(DATA_DIR, { recursive: true });
	sweepPrevious();
	// Adult ids are fixed per test, so parallel projects and repeats reuse them: never swept.
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, pin_hash) VALUES (?, 'Test Adult', 'adult', 'member-1', ?)"
	).run(id, hashPin(PIN));
	db.close();
	const res = await page.request.post('/api/auth/pin', {
		data: { memberId: id, pin: PIN, remember: true }
	});
	if (!res.ok()) throw new Error(`adult sign-in failed: ${res.status()}`);
}

/**
 * Makes sure the shared test server is past first-run setup (otherwise every app page redirects
 * to /setup). Idempotent; the baseline adult is never deleted by other tests.
 */
export function ensureHousehold(): void {
	mkdirSync(DATA_DIR, { recursive: true });
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR IGNORE INTO members (id, name, role, color, pin_hash) VALUES ('e2e-baseline-adult', 'Baseline Adult', 'adult', 'member-1', ?)"
	).run(hashPin(PIN));
	db.close();
}
