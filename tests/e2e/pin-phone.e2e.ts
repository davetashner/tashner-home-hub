import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPin } from '../../src/lib/server/domain/pin';

// The PIN pad on phone screens: keys never overlap, and the whole unlock flow fits. Only reads
// the unlock page; the two adults are synthetic and removed afterwards.
const screens = [
	{ w: 375, h: 667, landscape: false },
	{ w: 390, h: 844, landscape: false },
	{ w: 393, h: 852, landscape: false },
	{ w: 430, h: 932, landscape: false },
	{ w: 844, h: 390, landscape: true },
	{ w: 852, h: 393, landscape: true },
	{ w: 667, h: 375, landscape: true }
];
const seeded: string[] = [];

function withDb(fn: (db: Database.Database) => void): void {
	mkdirSync('data', { recursive: true });
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	try {
		fn(db);
	} finally {
		db.close();
	}
}

test.afterAll(() =>
	withDb((db) => {
		for (const id of seeded) db.prepare('DELETE FROM members WHERE id = ?').run(id);
	})
);

async function openPad(page: Page, name: string) {
	for (const id of [name, `${name} Partner`]) {
		seeded.push(id);
		withDb((db) =>
			db
				.prepare(
					"INSERT OR REPLACE INTO members (id, name, role, color, pin_hash) VALUES (?, ?, 'adult', 'x', ?)"
				)
				.run(id, id, hashPin('4817'))
		);
	}
	await page.goto('/unlock');
	await expect(async () => {
		await page.getByRole('button', { name, exact: true }).click();
		await expect(page.getByTestId('pinpad')).toBeVisible({ timeout: 1000 });
	}).toPass();
}

for (const { w, h, landscape } of screens) {
	test(`PIN pad fits ${w}x${h}`, async ({ page }, info) => {
		await page.setViewportSize({ width: w, height: h });
		await openPad(page, `Phone ${w}x${h} ${info.project.name}`);
		const buttons = page.locator('[data-testid="pinpad"] button');
		await expect(buttons).toHaveCount(12);
		const boxes = await Promise.all((await buttons.all()).map((b) => b.boundingBox()));

		for (const [i, a] of boxes.entries()) {
			expect(a).not.toBeNull();
			expect(a!.width).toBeGreaterThanOrEqual(60);
			expect(a!.height).toBeGreaterThanOrEqual(60);
			expect(a!.x).toBeGreaterThanOrEqual(0);
			expect(a!.x + a!.width).toBeLessThanOrEqual(w);
			expect(a!.y).toBeGreaterThanOrEqual(0);
			expect(a!.y + a!.height).toBeLessThanOrEqual(h);
			for (const b of boxes.slice(i + 1)) {
				const apart =
					a!.x + a!.width <= b!.x + 0.5 ||
					b!.x + b!.width <= a!.x + 0.5 ||
					a!.y + a!.height <= b!.y + 0.5 ||
					b!.y + b!.height <= a!.y + 0.5;
				expect(apart, `keys ${i} and later overlap`).toBe(true);
			}
		}

		// OK and backspace are reachable without scrolling.
		for (const name of ['Enter PIN', 'Delete last digit']) {
			const box = (await page.getByRole('button', { name }).boundingBox())!;
			expect(box.y + box.height).toBeLessThanOrEqual(h);
		}
		await page.getByRole('button', { name: '1', exact: true }).click();
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		await expect(page.getByTestId('pin-dots')).toHaveAttribute('data-count', '1');
		await page.getByRole('button', { name: 'Delete last digit' }).click();
		await expect(page.getByTestId('pin-dots')).toHaveAttribute('data-count', '0');

		const heading = (await page.getByRole('heading', { name: 'Grown-ups only' }).boundingBox())!;
		expect(heading.y).toBeGreaterThanOrEqual(0);
		const remember = (await page.getByRole('checkbox').boundingBox())!;
		expect(remember.y + remember.height).toBeLessThanOrEqual(h);
		await expect(page.getByText('Unlocking as')).toBeVisible();
		if (!landscape) {
			const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
			expect(docHeight).toBeLessThanOrEqual(h);
		}
	});
}
