import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { px } from './tap';
import { trackMember } from './cleanup';

// MSG-1: sticky notes on Home. Runs in both wall orientations and the phone viewports.

function seedKid(id: string, name: string, avatar: string) {
	ensureHousehold();
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, ?, 'child', 'member-3', ?)"
	).run(id, name, avatar);
	db.close();
	trackMember(id);
}

function wipe(tag: string) {
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare('DELETE FROM notes WHERE body LIKE ?').run(`%${tag}%`);
	db.close();
}

async function kidPostsAdultPinsAnyoneDismisses(
	page: Page,
	browser: Browser,
	info: TestInfo
): Promise<void> {
	const tag = `n${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const kidId = `e2e-notes-kid-${tag}`;
	const kidName = `Kid ${tag}`;
	seedKid(kidId, kidName, '🦊');
	try {
		// A kid screen: no adult session at all.
		await gotoHydrated(page, '/');
		await page.getByTestId('note-add').click();
		const post = page.getByTestId('note-post');
		await expect(post).toBeDisabled();
		await page.getByTestId('note-author').filter({ hasText: kidName }).click();
		await page.getByTestId('note-body').fill(`Milk please ${tag}`);
		await page.getByTestId('note-emoji-toggle').click();
		await page.getByTestId('note-emoji').first().click();
		await page.getByTestId('note-color').nth(1).click();
		await page.getByTestId('note-until').filter({ hasText: 'A week' }).click();
		const avatar = await page.getByTestId('note-author').filter({ hasText: kidName }).boundingBox();
		expect(px(avatar!.height)).toBeGreaterThanOrEqual(96);
		await post.click();

		const mine = page.getByTestId('note').filter({ hasText: tag });
		await expect(mine).toHaveCount(1);
		await expect(mine).toContainText(kidName);
		await expect(mine).toContainText('📖');
		await expect(mine).toContainText('Until');
		await expect(page.getByTestId('note-pin')).toHaveCount(0); // pinning is adult-only
		const dismiss = await mine.getByTestId('note-dismiss').boundingBox();
		expect(px(dismiss!.width)).toBeGreaterThanOrEqual(60);
		expect(px(dismiss!.height)).toBeGreaterThanOrEqual(60);

		// Survives a reload (it reached the server) and a kid cannot pin through the API.
		await gotoHydrated(page, '/');
		await expect(mine).toHaveCount(1);
		const id = (
			(await (await page.request.get('/api/notes')).json()) as { id: string; body: string }[]
		).find((n) => n.body.includes(tag))!.id;
		const denied = await page.request.patch(`/api/notes/${id}`, { data: { pinned: true } });
		expect(denied.status()).toBe(401);

		// An adult's wall sees it live, pins it to the front.
		const ctx = await browser.newContext({
			baseURL: info.project.use.baseURL,
			viewport: page.viewportSize() ?? undefined
		});
		const adult = await ctx.newPage();
		await signInAsAdult(adult, `e2e-notes-adult-${info.project.name}`);
		await gotoHydrated(adult, '/');
		const theirs = adult.getByTestId('note').filter({ hasText: tag });
		await expect(theirs).toHaveCount(1);
		await theirs.getByTestId('note-pin').click();
		await expect(theirs).toHaveAttribute('data-pinned', 'true');
		await expect(adult.getByTestId('note').first()).toContainText(tag);
		// ...and the kid's screen follows over SSE.
		await expect(mine).toHaveAttribute('data-pinned', 'true', { timeout: 3_000 });

		// Anyone dismisses; the other screen drops it too.
		await mine.getByTestId('note-dismiss').click();
		await expect(mine).toHaveCount(0);
		await expect(theirs).toHaveCount(0, { timeout: 3_000 });
		await ctx.close();
	} finally {
		wipe(tag);
	}
}

test('a kid posts without a PIN, an adult pins, anyone dismisses', async ({
	page,
	browser
}, info) => {
	await kidPostsAdultPinsAnyoneDismisses(page, browser, info);
});

test.describe('phone viewport', () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test('the same flow works on a phone', async ({ page, browser }, info) => {
		await kidPostsAdultPinsAnyoneDismisses(page, browser, info);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
			.toBe(true);
	});
});

test('a note that has expired is gone', async ({ page }, info) => {
	const tag = `x${Date.now().toString(36)}${info.workerIndex}${info.repeatEachIndex}`;
	const kidId = `e2e-notes-kid-${tag}`;
	const kidName = `Kid ${tag}`;
	seedKid(kidId, kidName, '🦊');
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT INTO notes (id, author_id, body, color, pinned, created_at, expires_at) VALUES (?, ?, ?, 'note-blue', 0, ?, ?)"
	).run(`gone-${tag}`, kidId, `stale ${tag}`, Date.now() - 5000, Date.now() - 1000);
	db.close();
	try {
		await gotoHydrated(page, '/');
		await expect(page.getByTestId('home-notes')).toBeVisible();
		await expect(page.getByTestId('note').filter({ hasText: tag })).toHaveCount(0);
	} finally {
		wipe(tag);
	}
});
