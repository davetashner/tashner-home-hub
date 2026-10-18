import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

test('home shows the wall clock @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('clock-time')).toBeVisible();
	await expect(page.getByTestId('clock-date')).toBeVisible();
});

test('health endpoint responds ok @J16.6', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.ok()).toBe(true);
	expect(await response.json()).toMatchObject({ status: 'ok' });
});
