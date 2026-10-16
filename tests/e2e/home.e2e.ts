import { expect, test } from '@playwright/test';

test('home shows the wall clock', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('clock-time')).toBeVisible();
	await expect(page.getByTestId('clock-date')).toBeVisible();
});

test('health endpoint responds ok', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.ok()).toBe(true);
	expect(await response.json()).toMatchObject({ status: 'ok' });
});
