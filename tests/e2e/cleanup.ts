import { test } from '@playwright/test';
import Database from 'better-sqlite3';

/**
 * Every project shares one server and one SQLite file for the whole run, and specs seed members
 * and chores without removing them. Left alone, the database grows to hundreds of rows, which
 * slows hydration on list pages and crowds member lists. Helpers that seed members call
 * `trackMember`; the first seed of the NEXT test in the same worker removes what the previous
 * test created (that test has finished, and a worker runs one test at a time).
 */
let owner: string | null = null;
let ids: string[] = [];

function currentTest(): string | null {
	try {
		const info = test.info();
		// Members seeded in a beforeAll hook may be shared by the file's tests: leave them.
		return /hook/i.test(info.title)
			? null
			: `${info.titlePath.join(' > ')}#${info.repeatEachIndex}`;
	} catch {
		return null;
	}
}

/** Removes members (and their chores) that an earlier test in this worker seeded. */
export function sweepPrevious(): void {
	const now = currentTest();
	if (now === null || now === owner) return;
	const stale = ids;
	ids = [];
	owner = now;
	if (stale.length === 0) return;
	const db = new Database('data/hub.db');
	try {
		db.pragma('busy_timeout = 5000');
		db.pragma('foreign_keys = ON');
		const dropChores = db.prepare('DELETE FROM chores WHERE member_ids LIKE ?');
		const dropMember = db.prepare(
			"DELETE FROM members WHERE id = ? AND id != 'e2e-baseline-adult'"
		);
		for (const id of stale) {
			dropChores.run(`%"${id}"%`);
			dropMember.run(id);
		}
	} finally {
		db.close();
	}
}

/** Marks a member (with a unique id: kids created through the API) as seeded by the running test, so a later test in this worker removes it. */
export function trackMember(id: string): void {
	if (currentTest() === null) return;
	sweepPrevious();
	ids.push(id);
}
