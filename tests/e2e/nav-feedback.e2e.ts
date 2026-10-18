import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

/**
 * hub-ugl.4.9: a pressed nav item looks active the moment the press starts (data-selected), while
 * aria-current stays on the real route. If the press never becomes a tap, the nav rolls back.
 */
test('a press that slides off the item rolls the nav back to the real route', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.waitForLoadState('networkidle');
	const nav = page.getByRole('navigation', { name: 'Main' });
	const lists = nav.getByRole('link', { name: 'Lists' });
	await lists.click();
	await expect(page).toHaveURL(/\/lists$/);
	await expect(lists).toHaveAttribute('data-selected', 'true');

	const calendar = nav.getByRole('link', { name: 'Calendar' });
	const box = (await calendar.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await expect(calendar).toHaveAttribute('data-selected', 'true');
	await expect(lists).not.toHaveAttribute('data-selected', 'true');
	// Assistive tech keeps hearing the real page until a navigation lands.
	await expect(lists).toHaveAttribute('aria-current', 'page');
	await expect(calendar).not.toHaveAttribute('aria-current', 'page');

	// Slide off the nav and let go: no click, so no navigation.
	await page.mouse.move(box.x + box.width / 2, box.y - 400, { steps: 4 });
	await page.mouse.up();
	await expect(calendar).not.toHaveAttribute('data-selected', 'true');
	await expect(lists).toHaveAttribute('data-selected', 'true');
	await expect(lists).toHaveAttribute('aria-current', 'page');
	await expect(page).toHaveURL(/\/lists$/);
});

test('tapping a destination marks it selected and lands with aria-current', async ({ page }) => {
	await gotoHydrated(page, '/');
	await page.waitForLoadState('networkidle');
	const nav = page.getByRole('navigation', { name: 'Main' });
	const meals = nav.getByRole('link', { name: 'Meals' });
	await meals.click();
	await expect(page).toHaveURL(/\/meals$/);
	await expect(meals).toHaveAttribute('aria-current', 'page');
	await expect(meals).toHaveAttribute('data-selected', 'true');
	await expect(nav.locator('[data-selected="true"]')).toHaveCount(1);
});
