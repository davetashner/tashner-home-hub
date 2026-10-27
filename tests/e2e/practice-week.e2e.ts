import { expect, test, type Page } from '@playwright/test';
import { seedKid } from './kid';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

async function weekKid(page: Page, label: string) {
	const { memberId } = await seedKid(page, label);
	await page.context().clearCookies(); // the kid screen needs no adult session
	return memberId;
}

async function openWeek(page: Page, id: string) {
	await gotoHydrated(page, `/chores?member=${id}`);
	await page.getByTestId('practice-open').click();
	await page.getByTestId('practice-tab-week').click();
}

test('A kid sees their reading and practice week, with today lit up @J1.15', async ({
	page
}, info) => {
	const id = await weekKid(page, `week${info.project.name}`);
	const summary = (await (await page.request.get(`/api/members/${id}/practice-logs`)).json()) as {
		activityId: string;
	}[];
	for (const [i, minutes] of [45, 30].entries())
		await page.request.post(`/api/members/${id}/practice-logs`, {
			data: { activityId: summary[i % summary.length].activityId, minutes }
		});

	await openWeek(page, id);
	const chart = page.getByTestId('practice-week-chart');
	await expect(chart).toBeVisible();
	await expect(page.getByTestId('practice-week-day')).toHaveCount(7);
	await expect(page.getByTestId('practice-week-total')).toContainText(
		'75 minutes this week, 5 stars'
	);
	const today = page.locator('[data-testid="practice-week-day"][data-today="true"]');
	await expect(today).toHaveCount(1);
	await expect(today).toHaveAttribute('data-minutes', '75');
	await expect(page.getByTestId('practice-week-legend').locator('li')).toHaveCount(2);
	await expectTappable(page.getByTestId('practice-week-prev'), 96);
	await expect(page.getByTestId('practice-week-next')).toBeDisabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

	// Last week is empty, and next brings us back.
	await page.getByTestId('practice-week-prev').click();
	await expect(page.getByTestId('practice-week-total')).toContainText('No reading yet this week');
	await expect(page.locator('[data-today="true"]')).toHaveCount(0);
	await page.getByTestId('practice-week-next').click();
	await expect(page.getByTestId('practice-week-total')).toContainText('75 minutes');
});

test('The week chart starts empty and follows a new log @J1.15', async ({ page }, info) => {
	const id = await weekKid(page, `wk0${info.project.name}`);
	await openWeek(page, id);
	await expect(page.getByTestId('practice-week-total')).toContainText(
		'No reading yet this week. Log some!'
	);
	await page.getByTestId('practice-tab-log').click();
	await page.getByTestId('practice-chip').nth(1).click(); // 15 min = 1 star
	await page.getByTestId('practice-save').click();
	await page.getByTestId('practice-open').click();
	await page.getByTestId('practice-tab-week').click();
	await expect(page.getByTestId('practice-week-total')).toContainText(
		'15 minutes this week, 1 star'
	);
	await expect(page.locator('[data-today="true"]')).toHaveAttribute('data-minutes', '15');
});
