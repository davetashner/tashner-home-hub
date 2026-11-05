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
