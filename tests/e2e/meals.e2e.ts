import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';

// MEAL-1. Each project plans a different far-future week so parallel projects sharing one database
// never see each other's dinner. Mondays: 2043-06-01 is a Monday; offset by project.
const PROJECTS = [
	'wall-landscape-1440p',
	'wall-portrait-1440p',
	'iphone-webkit',
	'ipad-portrait-webkit',
	'ipad-landscape-webkit'
];
const JSON_HEADERS = { 'content-type': 'application/json' };

test('plan a dinner, see it in Meals and the calendar week, edit it, delete it', async ({
	page
}, info) => {
	test.setTimeout(60_000); // three page loads on a busy shard
	ensureHousehold();
	const k = Math.max(0, PROJECTS.indexOf(info.project.name));
	const monday = new Date(Date.UTC(2043, 5, 1 + 7 * k)).toISOString().slice(0, 10);
	const tuesday = new Date(Date.UTC(2043, 5, 2 + 7 * k)).toISOString().slice(0, 10);
	await page.clock.setFixedTime(new Date(`${tuesday}T12:00:00`));
	const tag = `${info.project.name}-${Date.now().toString(36)}`;
	const dinner = `Tacos ${tag}`;
	const edited = `Pasta ${tag}`;

	try {
		const put = await page.request.put('/api/meals', {
			headers: JSON_HEADERS,
			data: { date: tuesday, meal: 'dinner', title: dinner }
		});
		expect(put.ok()).toBe(true);

		await page.goto('/meals');
		const day = page.locator(`[data-testid="meals-day"][data-date="${tuesday}"]`);
		await expect(day).toContainText(dinner);

		// The calendar's week view shows it under the date (when the pane is wide enough for the grid).
		await page.addInitScript(() => localStorage.setItem('hub.calendar.view', 'week'));
		await page.goto('/calendar');
		const pane = page.getByTestId('calendar-pane');
		await expect(pane).toBeVisible();
		if ((await pane.boundingBox())!.width >= 720) {
			await expect(page.getByTestId('week-meal').filter({ hasText: dinner })).toBeVisible();
		}
		await page.goto('/meals');

		// Edit through the sheet.
		await expect(async () => {
			await day.locator('[data-slot="dinner"]').click();
			await expect(page.getByTestId('meal-input')).toBeVisible({ timeout: 1000 });
		}).toPass();
		await page.getByTestId('meal-input').fill(edited);
		await page.getByTestId('meal-save').click();
		await expect(day).toContainText(edited);
		await expect(day).not.toContainText(dinner);
		const got = await page.request.get(`/api/meals?week=${monday}`);
		expect(await got.json()).toContainEqual({ date: tuesday, meal: 'dinner', title: edited });

		await expect(day).toHaveClass(/today/);

		// No sideways scroll (390px phone and every other viewport).
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	} finally {
		const del = await page.request.delete('/api/meals', {
			headers: JSON_HEADERS,
			data: { date: tuesday, meal: 'dinner' }
		});
		expect([200, 404]).toContain(del.status());
	}
});

test('meals fits a 390px phone with no sideways scroll', async ({ page }) => {
	ensureHousehold();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/meals');
	await expect(page.getByTestId('meals-day')).toHaveCount(7);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	const box = await page.getByTestId('meal-cell').first().boundingBox();
	expect(box!.height).toBeGreaterThanOrEqual(60);
});
