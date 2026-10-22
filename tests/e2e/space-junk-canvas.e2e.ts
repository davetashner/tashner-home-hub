import { expect, test } from '@playwright/test';
import { gotoHydrated } from './hydrated';

test('Space Junk canvas draws and a pull on the slingshot fires a Junkbot', async ({ page }) => {
	await gotoHydrated(page, '/dev/space-junk');
	const canvas = page.getByTestId('space-junk-canvas');
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute('data-phase', 'aiming');
	await expect(canvas).toHaveAttribute('data-junkbots', '3');

	const box = (await canvas.boundingBox())!;
	const ax = box.x + Number(await canvas.getAttribute('data-anchor-x'));
	const ay = box.y + Number(await canvas.getAttribute('data-anchor-y'));
	await page.mouse.move(ax, ay);
	await page.mouse.down();
	await page.mouse.move(ax - 60, ay + 30, { steps: 5 });
	await page.mouse.up();
	await expect(canvas).toHaveAttribute('data-junkbots', '2');
});
