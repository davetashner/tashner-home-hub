import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { seedCalendar } from './calendar';
import { gotoHydrated } from './hydrated';

// hub-b4z.3: the home page shows this week's calendar; an event opens its sheet.
test.beforeAll(ensureHousehold);

test("home shows this week's calendar and opens an event @J0.2", async ({ page }) => {
	seedCalendar();
	await gotoHydrated(page, '/');
	const week = page.getByTestId('home-week');
	await expect(week).toBeVisible();
	await expect(week.getByText('Soccer practice').first()).toBeVisible();
	await expect(week.getByText('School holiday').first()).toBeVisible();

	// One screen tall: Notes stays on screen below the week.
	const view = page.viewportSize()!;
	const notes = (await page.getByTestId('home-notes').boundingBox())!;
	expect(notes.y + notes.height).toBeLessThanOrEqual(view.height);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	await week
		.getByRole('button', { name: /Soccer practice/ })
		.first()
		.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('heading', { name: 'Soccer practice' })).toBeVisible();
	await expect(sheet.getByTestId('event-countdown')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

// hub-kb9: on a Saturday the next week is one swipe (or tap) away.
test('home week pages to next week and back @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/');
	const week = page.getByTestId('home-week');
	const title = page.getByTestId('home-week-title');
	await expect(title).toHaveText('This week');

	await week.getByTestId('home-week-next').click();
	await expect(title).toHaveText('Next week');
	await week.getByTestId('home-week-next').click();
	await expect(title).not.toHaveText(/week/);

	await week.getByTestId('home-week-today').click();
	await expect(title).toHaveText('This week');
	await expect(week.getByTestId('home-week-today')).toBeHidden();

	await week.getByTestId('home-week-prev').click();
	await expect(title).toHaveText('Last week');
});

test('game-day strip sits below the week, above Notes', async ({ page }) => {
	await gotoHydrated(page, '/');
	const order = await page.evaluate(() => {
		const els = [...document.querySelectorAll('[data-testid]')].map((e) =>
			e.getAttribute('data-testid')
		);
		return { week: els.indexOf('home-week'), notes: els.indexOf('home-notes') };
	});
	expect(order.week).toBeGreaterThanOrEqual(0);
	expect(order.week).toBeLessThan(order.notes);
});
