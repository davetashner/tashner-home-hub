import { expect, test, type Page } from '@playwright/test';
import { seedKid } from './kid';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

/**
 * A kid with chores: the kid screen only lists kids who have something to do, and the shared test
 * database holds other kids' chores. The chore seed leaves the kid with 2 stars (see kid.ts).
 */
const START = 2;
async function practiceKid(page: Page, label: string) {
	const { memberId } = await seedKid(page, label);
	await page.context().clearCookies(); // the kid screen needs no adult session
	return memberId;
}

const balance = async (page: Page, id: string) =>
	((await (await page.request.get(`/api/members/${id}/stars`)).json()) as { balance: number })
		.balance;

test('A kid logs reading and the star lands at once, up to the daily cap @J1.12', async ({
	page
}, info) => {
	const id = await practiceKid(page, info.project.name);
	await gotoHydrated(page, `/chores?member=${id}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();

	const open = page.getByTestId('practice-open');
	// Visible before the first log, in both orientations, whatever chores exist.
	await expect(open).toBeVisible();
	await expect(open).toBeInViewport();
	await expect(open).toContainText('Log reading');
	await expectTappable(open, 96);
	await open.click();
	const sheet = page.getByTestId('practice-sheet');
	await expect(sheet).toBeVisible();
	for (const t of [
		page.getByTestId('practice-activity').first(),
		page.getByTestId('practice-chip').first(),
		page.getByTestId('practice-plus'),
		page.getByTestId('practice-save')
	])
		await expectTappable(t, 96);
	await expect(sheet.getByTestId('practice-activity')).toHaveCount(2);
	// The sheet never makes the page scroll sideways.
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

	// 10 minutes is short of a star; the hint says how far away the next one is.
	await page.getByTestId('practice-chip').first().click();
	await expect(page.getByTestId('practice-hint')).toContainText('15 more minutes');
	await page.getByTestId('practice-plus').click();
	await expect(page.getByTestId('practice-minutes')).toContainText('15');
	await expect(page.getByTestId('practice-hint')).toContainText('You will earn 1 star');
	await page.getByTestId('practice-save').click();
	await expect(sheet).toBeHidden();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 1 star');
	await expect.poll(() => balance(page, id)).toBe(START + 1);

	// Everything over the cap (4 stars) earns nothing more.
	await open.click();
	await page.getByTestId('practice-chip').nth(3).click(); // 30 min = 2 stars
	await page.getByTestId('practice-save').click();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 3 stars');
	await open.click();
	for (let i = 0; i < 6; i++) await page.getByTestId('practice-plus').click(); // 60 min
	await page.getByTestId('practice-save').click();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 4 stars');
	await expect.poll(() => balance(page, id)).toBe(START + 4);
	await open.click();
	await expect(page.getByTestId('practice-hint')).toHaveText('All stars earned today!');
	await page.getByTestId('practice-save').click();
	await expect.poll(() => balance(page, id)).toBe(START + 4);
});

test('A kid takes back a logged session within the undo window @J1.13', async ({ page }, info) => {
	const id = await practiceKid(page, `undo${info.project.name}`);
	await gotoHydrated(page, `/chores?member=${id}`);
	await page.getByTestId('practice-open').click();
	await page.getByTestId('practice-chip').nth(1).click(); // 15 min
	await page.getByTestId('practice-save').click();
	await expect.poll(() => balance(page, id)).toBe(START + 1);

	const undo = page.getByTestId('practice-undo');
	await expectTappable(undo, 96);
	await undo.click();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 0 stars');
	await expect.poll(() => balance(page, id)).toBe(START);
	const summary = (await (await page.request.get(`/api/members/${id}/practice-logs`)).json()) as {
		minutesToday: number;
	}[];
	expect(summary.every((s) => s.minutesToday === 0)).toBe(true);
});
