import { expect, test } from '@playwright/test';

test.describe('collapsible nav rail', () => {
	test('collapse widens the content, survives reload, handle restores', async ({ page }) => {
		await page.goto('/photos');
		await page.waitForLoadState('networkidle');
		const viewport = page.viewportSize()!;
		if (viewport.height > viewport.width) {
			// Portrait keeps its bottom bar: no collapse control at all.
			await expect(page.getByTestId('nav-collapse')).toBeHidden();
			return;
		}
		const main = page.locator('main');
		const before = (await main.boundingBox())!;
		expect(before.width).toBeLessThan(viewport.width - 100);

		await page.getByTestId('nav-collapse').click();
		await expect(page.getByTestId('nav-handle')).toBeVisible();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(viewport.width, 0);
		const handle = (await page.getByTestId('nav-handle').boundingBox())!;
		expect(handle.width).toBeGreaterThanOrEqual(96);
		expect(handle.height).toBeGreaterThanOrEqual(96);

		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('nav-handle')).toBeVisible();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(viewport.width, 0);

		await page.getByTestId('nav-handle').click();
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(before.width, 0);
	});
});
