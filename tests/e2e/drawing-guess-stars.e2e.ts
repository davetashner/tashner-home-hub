import { expect, test, type Browser, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';
import { reveal } from './drawing-sections';
import { expectTappable } from './tap';

// hub-t27j.25: a right guess in draw and guess pays both kids one star, once per round, kids only,
// and a grown-up can turn it off in Settings > Drawing.

function db<T>(fn: (d: Database.Database) => T): T {
	const d = new Database(DB_PATH);
	d.pragma('busy_timeout = 5000');
	try {
		return fn(d);
	} finally {
		d.close();
	}
}

function seed(id: string, name: string, role: 'child' | 'adult') {
	db((d) =>
		d
			.prepare(
				"INSERT OR REPLACE INTO members (id, name, role, color) VALUES (?, ?, ?, 'member-3')"
			)
			.run(id, name, role)
	);
	trackMember(id);
}

const gameStars = (id: string) =>
	db(
		(d) =>
			(
				d
					.prepare(
						"SELECT COUNT(*) AS n FROM star_transactions WHERE member_id = ? AND reason = 'drawing' AND ref_id LIKE 'game:%'"
					)
					.get(id) as { n: number }
			).n
	);

const setGameStars = (on: boolean) =>
	db((d) => {
		d.prepare("DELETE FROM settings WHERE key = 'drawing.gameStars'").run();
		if (!on)
			d.prepare("INSERT INTO settings (key, value) VALUES ('drawing.gameStars', 'false')").run();
	});

async function device(browser: Browser, like: Page) {
	const context = await browser.newContext({ viewport: like.viewportSize() ?? undefined });
	const page = await context.newPage();
	await gotoHydrated(page, '/');
	return { context, page };
}

const pick = (page: Page, name: string) =>
	page.getByTestId('draw-guess-who-pick').filter({ hasText: name }).click();

async function solveRound(a: Page, b: Page, drawerName: string, guesserName: string) {
	await a.getByTestId('draw-guess-start').click();
	await pick(a, drawerName);
	await pick(b, guesserName);
	const word = (
		(await a.getByTestId('draw-guess-word').locator('span').textContent()) ?? ''
	).trim();
	const choices = b.getByTestId('draw-guess-choice');
	await expect(choices).toHaveCount(4);
	const labels = (await choices.allTextContents()).map((t) => t.trim());
	await choices.nth(labels.indexOf(word)).click();
	await expect(b.getByTestId('draw-guess-win')).toContainText(word);
	await expect(a.getByTestId('draw-guess-win')).toContainText(word);
}

async function share(a: Page, b: Page) {
	await gotoHydrated(a, '/');
	await a.getByTestId('note-draw').click();
	await reveal(a, 'draw-share');
	await a.getByTestId('draw-share').click();
	await reveal(a, 'draw-live-status');
	await b.getByTestId('draw-invite-join').click();
	await reveal(b, 'draw-live-status');
}

test('a right guess earns both kids a star, once per round, kids only, and the setting turns it off @J18.40', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	ensureHousehold();
	seed('e2e-gs-kid1', 'Ada Guess', 'child');
	seed('e2e-gs-kid2', 'Bo Guess', 'child');
	seed('e2e-gs-adult', 'Cy Guess', 'adult');
	setGameStars(true);
	const release = await holdLock('drawing-live');
	const b = await device(browser, page);
	try {
		await share(page, b.page);
		await expectTappable(page.getByTestId('draw-guess-start'), 96);
		await page.getByTestId('draw-guess-start').click();
		// "Who's playing?" has big taps and fits the card on a 4K wall.
		const who = page.getByTestId('draw-guess-who-pick').first();
		await expectTappable(who, 96);
		await page.setViewportSize({ width: 3840, height: 2160 });
		const card = await page.getByTestId('draw-guess').boundingBox();
		for (const w of await page.getByTestId('draw-guess-who-pick').all()) {
			const box = await w.boundingBox();
			expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
		}
		await pick(page, 'Ada Guess');
		await pick(b.page, 'Bo Guess');
		const word = (
			(await page.getByTestId('draw-guess-word').locator('span').textContent()) ?? ''
		).trim();
		const choices = b.page.getByTestId('draw-guess-choice');
		const labels = (await choices.allTextContents()).map((t) => t.trim());
		await choices.nth(labels.findIndex((l) => l !== word)).click();
		expect(gameStars('e2e-gs-kid1')).toBe(0);
		await choices.nth(labels.indexOf(word)).click();
		await expect(b.page.getByTestId('draw-guess-stars')).toContainText('star');
		await expect(page.getByTestId('draw-guess-stars')).toContainText('star');
		await expect.poll(() => gameStars('e2e-gs-kid1')).toBe(1);
		expect(gameStars('e2e-gs-kid2')).toBe(1);

		// A second tap on the solved round pays nothing; the next round pays again.
		await page.getByTestId('draw-guess-next').click();
		await expect(page.getByTestId('draw-guess')).toHaveAttribute('data-role', 'guesser');
		expect(gameStars('e2e-gs-kid1')).toBe(1);
		const c2 = page.getByTestId('draw-guess-choice');
		const w2 = (
			(await b.page.getByTestId('draw-guess-word').locator('span').textContent()) ?? ''
		).trim();
		const l2 = (await c2.allTextContents()).map((t) => t.trim());
		await c2.nth(l2.indexOf(w2)).click();
		await expect.poll(() => gameStars('e2e-gs-kid1')).toBe(2);
		expect(gameStars('e2e-gs-kid2')).toBe(2);
		await b.page.getByTestId('draw-guess-next').click();
	} finally {
		release();
		await b.page.goto('about:blank').catch(() => {});
		await b.context.close();
	}
});

test('an adult on a board earns nothing, and the setting off pays nobody @J18.40', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	ensureHousehold();
	seed('e2e-gs2-kid1', 'Ada Two', 'child');
	seed('e2e-gs2-adult', 'Cy Two', 'adult');
	const before = gameStars('e2e-gs2-kid1');
	setGameStars(true);
	const release = await holdLock('drawing-live');
	const b = await device(browser, page);
	try {
		await share(page, b.page);
		await solveRound(page, b.page, 'Cy Two', 'Ada Two');
		await expect.poll(() => gameStars('e2e-gs2-kid1')).toBe(before + 1);
		expect(gameStars('e2e-gs2-adult')).toBe(0);
		await page.getByTestId('draw-guess-next').click();
		await expect(page.getByTestId('draw-guess')).toHaveAttribute('data-role', 'guesser');

		// Off in Settings > Drawing: a right guess pays nobody.
		const admin = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
		const ap = await admin.newPage();
		await signInAsAdult(ap, 'e2e-baseline-adult');
		await gotoHydrated(ap, '/settings/drawing');
		await ap.getByTestId('game-stars-off').click();
		await expect(ap.getByTestId('game-stars-off')).toHaveAttribute('aria-pressed', 'true');
		await expect
			.poll(() =>
				db((d) => d.prepare("SELECT value FROM settings WHERE key = 'drawing.gameStars'").get())
			)
			.toBeTruthy();
		await admin.close();
		const w2 = (
			(await b.page.getByTestId('draw-guess-word').locator('span').textContent()) ?? ''
		).trim();
		const c2 = page.getByTestId('draw-guess-choice');
		const l2 = (await c2.allTextContents()).map((t) => t.trim());
		await c2.nth(l2.indexOf(w2)).click();
		await expect(page.getByTestId('draw-guess-win')).toBeVisible();
		await expect(page.getByTestId('draw-guess-stars')).toHaveCount(0);
		expect(gameStars('e2e-gs2-kid1')).toBe(before + 1);
	} finally {
		setGameStars(true);
		release();
		await b.page.goto('about:blank').catch(() => {});
		await b.context.close();
	}
});
