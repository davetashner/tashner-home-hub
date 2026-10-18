import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

// DEV-1/UI-8: an iPhone turned sideways gets a compact top bar, not the wall's side rail.
test.beforeAll(ensureHousehold);

const phones = [
	{ name: 'iPhone 852x393', width: 852, height: 393 },
	{ name: 'iPhone Pro Max 932x430', width: 932, height: 430 },
	{ name: 'iPhone SE 667x375', width: 667, height: 375 }
];
const routes = ['/', '/chores', '/calendar', '/photos', '/lists', '/meals', '/settings'];

for (const phone of phones) {
	test.describe(phone.name, () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize({ width: phone.width, height: phone.height });
		});

		for (const route of routes) {
			test(`${route} does not overflow the width @J16.3`, async ({ page }) => {
				await gotoHydrated(page, route);
				await page.waitForLoadState('networkidle');
				const { scrollWidth, innerWidth } = await page.evaluate(() => ({
					scrollWidth: document.documentElement.scrollWidth,
					innerWidth: window.innerWidth
				}));
				expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
			});
		}

		test('a Home control returns to the home page @J16.3', async ({ page }) => {
			await gotoHydrated(page, '/chores');
			await page.waitForLoadState('networkidle');
			const home = page.getByRole('link', { name: 'Home' });
			await expect(home).toBeVisible();
			await expectTappable(home);
			await home.click();
			await expect(page).toHaveURL(/\/$/);
		});

		test('the shell fits on screen with 60px tap targets @J16.3', async ({ page }) => {
			await gotoHydrated(page, '/chores');
			await page.waitForLoadState('networkidle');
			// Only the shell's own bar: page content may carry its own headers.
			const shell = page.locator('nav[aria-label="Main"]').locator('xpath=..');
			const controls = shell.locator(':scope > header a, :scope > header button, :scope > nav a');
			const count = await controls.count();
			expect(count).toBeGreaterThanOrEqual(8);
			for (let i = 0; i < count; i++) {
				const control = controls.nth(i);
				if (!(await control.isVisible())) continue;
				await expectTappable(control);
				const box = (await control.boundingBox())!;
				expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
				expect(box.y + box.height).toBeLessThanOrEqual(phone.height);
			}
		});
	});
}
