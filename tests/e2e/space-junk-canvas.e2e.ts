import { expect, test } from '@playwright/test';
import { gotoHydrated } from './hydrated';

test('Space Junk canvas draws and a pull on the slingshot fires a Junkbot', async ({ page }) => {
	await gotoHydrated(page, '/dev/space-junk');
	const canvas = page.getByTestId('space-junk-canvas');
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute('data-phase', 'aiming');
	await expect(canvas).toHaveAttribute('data-junkbots', '3');

	// The sky is not blank: some pixel differs from the corner.
	const drawn = await canvas.evaluate((el: HTMLCanvasElement) => {
		const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
		const first = d.slice(0, 4).join();
		for (let i = 4; i < d.length; i += 4) if (d.slice(i, i + 4).join() !== first) return true;
		return false;
	});
	expect(drawn).toBe(true);

	const box = (await canvas.boundingBox())!;
	const ax = box.x + Number(await canvas.getAttribute('data-anchor-x'));
	const ay = box.y + Number(await canvas.getAttribute('data-anchor-y'));
	await page.mouse.move(ax, ay);
	await page.mouse.down();
	await page.mouse.move(ax - 60, ay + 30, { steps: 5 });
	await page.mouse.up();
	await expect(canvas).toHaveAttribute('data-junkbots', '2');
});

test('a tiny pull cancels the shot', async ({ page }) => {
	await gotoHydrated(page, '/dev/space-junk');
	const canvas = page.getByTestId('space-junk-canvas');
	const box = (await canvas.boundingBox())!;
	const ax = box.x + Number(await canvas.getAttribute('data-anchor-x'));
	const ay = box.y + Number(await canvas.getAttribute('data-anchor-y'));
	await page.mouse.move(ax, ay);
	await page.mouse.down();
	await page.mouse.move(ax + 1, ay, { steps: 2 });
	await page.mouse.up();
	await expect(canvas).toHaveAttribute('data-junkbots', '3');
	await expect(canvas).toHaveAttribute('data-phase', 'aiming');
});
