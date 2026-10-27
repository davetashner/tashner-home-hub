import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

async function seedKid(page: import('@playwright/test').Page, label: string) {
	await signInAsAdult(page, `adult-practice-${label.replace(/\W/g, '')}`);
	const member = (await (
		await page.request.post('/api/members', {
			data: { name: `Kiki ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json()) as { id: string };
	trackMember(member.id);
	await page.context().clearCookies(); // the kid screen needs no adult session
	return member.id;
}

const balance = async (page: import('@playwright/test').Page, id: string) =>
	((await (await page.request.get(`/api/members/${id}/stars`)).json()) as { balance: number })
		.balance;

test('A kid logs reading and the star lands at once, up to the daily cap @J1.12', async ({
	page
}, info) => {
	const id = await seedKid(page, info.project.name);
	await gotoHydrated(page, `/chores?member=${id}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();

	const open = page.getByTestId('practice-open');
	// Visible before the first log, with nothing to do today, in both orientations.
	await expect(page.getByTestId('all-free')).toBeVisible();
	await expect(open).toBeVisible();
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
	await expect.poll(() => balance(page, id)).toBe(1);

	// Everything over the cap (4 stars) earns nothing more.
	await open.click();
	await page.getByTestId('practice-chip').nth(3).click(); // 30 min = 2 stars
	await page.getByTestId('practice-save').click();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 3 stars');
	await open.click();
	for (let i = 0; i < 6; i++) await page.getByTestId('practice-plus').click(); // 60 min
	await page.getByTestId('practice-save').click();
	await expect(page.getByTestId('practice-today')).toContainText('Today: 4 stars');
	await expect.poll(() => balance(page, id)).toBe(4);
	await open.click();
	await expect(page.getByTestId('practice-hint')).toHaveText('All stars earned today!');
	await page.getByTestId('practice-save').click();
	await expect.poll(() => balance(page, id)).toBe(4);
});

test('A kid takes back a logged session within the undo window @J1.13', async ({ page }, info) => {
	const id = await seedKid(page, `undo${info.project.name}`);
	await gotoHydrated(page, `/chores?member=${id}`);
	await page.getByTestId('practice-open').click();
	await page.getByTestId('practice-chip').nth(1).click(); // 15 min
	await page.getByTestId('practice-save').click();
	await expect.poll(() => balance(page, id)).toBe(1);

	const undo = page.getByTestId('practice-undo');
	await expectTappable(undo, 96);
	await undo.click();
	await expect(page.getByTestId('practice-today')).toContainText('Tell us what you did');
	await expect.poll(() => balance(page, id)).toBe(0);
	const summary = (await (await page.request.get(`/api/members/${id}/practice-logs`)).json()) as {
		minutesToday: number;
	}[];
	expect(summary.every((s) => s.minutesToday === 0)).toBe(true);
});
