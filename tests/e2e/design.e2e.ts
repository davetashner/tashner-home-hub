import { expect, test } from '@playwright/test';
import { px } from './tap';

test('every showcase button meets the touch target minimums', async ({ page }) => {
	await page.goto('/dev/design');
	const buttons = page.getByRole('button');
	const count = await buttons.count();
	expect(count).toBeGreaterThan(8);

	for (let i = 0; i < count; i++) {
		const button = buttons.nth(i);
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		const kid = (await button.innerText()).trim() === 'Tap for a star';
		const min = kid ? 96 : 60;
		const label = (await button.getAttribute('aria-label')) ?? (await button.innerText());
		expect(px(box!.width), `${label} width`).toBeGreaterThanOrEqual(min);
		expect(px(box!.height), `${label} height`).toBeGreaterThanOrEqual(min);
	}
});

test('kid-size buttons are at least 96px', async ({ page }) => {
	await page.goto('/dev/design');
	const kid = page.getByRole('button', { name: 'Tap for a star' });
	const box = await kid.boundingBox();
	expect(px(box!.height)).toBeGreaterThanOrEqual(96);
});

test('swipe pad reports the swipe direction', async ({ page }) => {
	await page.goto('/dev/design');
	await page.waitForLoadState('networkidle');
	const pad = page.getByTestId('swipe-pad');
	await pad.scrollIntoViewIfNeeded();
	const box = (await pad.boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.8, y, { steps: 5 });
	await page.mouse.up();
	await expect(pad).toHaveText('Swiped right');
});

test('night theme toggles', async ({ page }) => {
	await page.goto('/dev/design');
	await page.getByTestId('theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
});
