import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPin } from '../../src/lib/server/domain/pin';

export const PIN = '4817';

/** Seeds a synthetic adult straight into the server's SQLite file, then unlocks this page's session as them. */
export async function signInAsAdult(page: Page, id: string): Promise<void> {
	mkdirSync('data', { recursive: true });
	const db = new Database('data/hub.db');
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
