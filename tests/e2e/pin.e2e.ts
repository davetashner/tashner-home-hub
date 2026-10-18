import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { px } from './tap';
import Database from 'better-sqlite3';
import { hashPin } from '../../src/lib/server/domain/pin';
import { gotoHydrated } from './hydrated';
import { DATA_DIR, DB_PATH } from './data-dir';

// Synthetic adults with a synthetic PIN, written straight into the server's SQLite file.
// Each test gets its own member (lockout is tracked per client address and member).
const PIN = '4817';
const WRONG = '2580';
const seeded: string[] = [];

function withDb<T>(fn: (db: Database.Database) => T): T {
	mkdirSync(DATA_DIR, { recursive: true });
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function seedAdult(name: string): void {
	seeded.push(name);
	withDb((db) =>
		db
			.prepare(
				"INSERT OR REPLACE INTO members (id, name, role, color, pin_hash) VALUES (?, ?, 'adult', 'x', ?)"
			)
			.run(name, name, hashPin(PIN))
	);
}

test.afterAll(() => {
	withDb((db) => {
		for (const id of seeded) db.prepare('DELETE FROM members WHERE id = ?').run(id);
	});
});

async function enter(page: Page, pin: string) {
	for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
	await page.getByRole('button', { name: 'Enter PIN' }).click();
}

async function openPad(page: Page, name: string, next = '/') {
	// A second adult keeps the member picker visible regardless of test ordering.
	seedAdult(name);
	seedAdult(`${name} Partner`);
	await gotoHydrated(page, `/unlock?next=${encodeURIComponent(next)}`);
	await page.getByRole('button', { name, exact: true }).click();
	await expect(page.getByTestId('pinpad')).toBeVisible();
}

test('keys are at least 96px', async ({ page }, info) => {
	await openPad(page, `Keys ${info.project.name}`);
	// locator.all() does not wait: let the pad render before measuring it.
	await expect(page.locator('[data-testid="pinpad"] button')).toHaveCount(12);
	const keys = await page.locator('[data-testid="pinpad"] button').all();
	expect(keys).toHaveLength(12);
	for (const key of keys) {
		const box = (await key.boundingBox())!;
		expect(px(box.width)).toBeGreaterThanOrEqual(96);
		expect(px(box.height)).toBeGreaterThanOrEqual(96);
	}
});

test('wrong PIN shakes and clears the dots', async ({ page }, info) => {
	await openPad(page, `Shake ${info.project.name}`);
	await enter(page, WRONG);
	await expect(page.getByTestId('pin-message')).toHaveText('Wrong PIN.');
	await expect(page.getByTestId('pin-dots')).toHaveClass(/shake/);
	await expect(page.getByTestId('pin-dots')).toHaveAttribute('data-count', '0');
});

test('correct PIN redirects to next', async ({ page }, info) => {
	await openPad(page, `Redirect ${info.project.name}`, '/healthz');
	await enter(page, PIN);
	await expect(page).toHaveURL(/\/healthz$/);
	const cookies = await page.context().cookies();
	expect(cookies.find((c) => c.name === 'hub_session')).toMatchObject({
		httpOnly: true,
		sameSite: 'Strict'
	});
});

test('locks after five wrong attempts', async ({ page }, info) => {
	await openPad(page, `Lock ${info.project.name}`);
	for (let i = 0; i < 5; i++) {
		await enter(page, WRONG);
		await expect(page.getByTestId('pin-message')).not.toHaveText('');
	}
	await expect(page.getByTestId('pin-message')).toContainText('Locked');
	await expect(page.getByRole('button', { name: '1', exact: true })).toBeDisabled();
});
