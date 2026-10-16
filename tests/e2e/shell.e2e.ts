import { expect, test, type Page } from '@playwright/test';
import { px } from './tap';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

const destinations = ['Calendar', 'Chores', 'Photos', 'Lists', 'Meals'];

async function swipe(page: Page, from: number, to: number) {
	const box = (await page.locator('main').boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * from, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
	await page.mouse.up();
}

test('every destination is reachable by tap and marks itself active', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const nav = page.getByRole('navigation', { name: 'Main' });
	for (const name of destinations) {
		await nav.getByRole('link', { name }).click();
		await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
		await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
		await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	}
});

test('settings gear opens settings', async ({ page }) => {
	await signInAsAdult(page, 'e2e-shell-adult');
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
});

test('shell controls meet the 60px touch minimum', async ({ page }) => {
	await page.goto('/chores');
	const controls = page.locator('header a, header button, nav a');
	const count = await controls.count();
	expect(count).toBeGreaterThanOrEqual(8);
	for (let i = 0; i < count; i++) {
		const box = (await controls.nth(i).boundingBox())!;
		const label =
			(await controls.nth(i).innerText()) || (await controls.nth(i).getAttribute('aria-label'));
		expect(px(box.width), `${label} width`).toBeGreaterThanOrEqual(60);
		expect(px(box.height), `${label} height`).toBeGreaterThanOrEqual(60);
	}
});

test('swiping moves to the adjacent destination', async ({ page }) => {
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	await swipe(page, 0.8, 0.2);
	await expect(page).toHaveURL(/\/photos$/);
	await swipe(page, 0.2, 0.8);
	await expect(page).toHaveURL(/\/chores$/);
});

test('sleep button posts to the display endpoint', async ({ page }) => {
	await page.goto('/calendar');
	await page.waitForLoadState('networkidle');
	const request = page.waitForRequest(
		(r) => r.url().endsWith('/api/display/sleep') && r.method() === 'POST'
	);
	await page.getByRole('button', { name: 'Sleep' }).click();
	const response = await (await request).response();
	expect(response?.status()).toBe(202);
});

test('sleep endpoint answers 202 with the power state', async ({ request }) => {
	const response = await request.post('/api/display/sleep', {
		data: {}
	});
	expect(response.status()).toBe(202);
	expect(await response.json()).toMatchObject({ power: 'off' });
});

test('header clock and date are visible away from home', async ({ page }) => {
	await page.goto('/lists');
	await expect(page.getByTestId('header-clock-time')).toBeVisible();
	await expect(page.getByTestId('header-clock-date')).toBeVisible();
});
