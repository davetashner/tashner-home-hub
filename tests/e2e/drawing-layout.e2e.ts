import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

// hub-cn7.37.5: the rail layout. Portrait gives the canvas most of the height; landscape keeps the
// prompt banner clear of the Pen options.

test.beforeAll(() => ensureHousehold());

const DATE = '2026-10-31';

async function openBoard(page: import('@playwright/test').Page) {
	await page.route('**/api/settings/drawing-prompts', (route) =>
		route.fulfill({ json: { enabled: true, date: DATE } })
	);
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await expect(page.getByTestId('draw-prompt-banner')).toBeVisible();
	await expect(page.getByTestId('draw-options-title')).toHaveText('Pen');
}

test('portrait: the canvas is taller than the options panel', async ({ page }) => {
	const vp = page.viewportSize()!;
	test.skip(vp.height <= vp.width, 'portrait only');
	await openBoard(page);
	const holder = (await page.getByTestId('draw-holder').boundingBox())!;
	const panel = (await page.getByTestId('draw-panel').boundingBox())!;
	expect(holder.height).toBeGreaterThan(vp.height * 0.55);
	expect(holder.height).toBeGreaterThan(panel.height);
	expect(holder.y + holder.height).toBeLessThanOrEqual(panel.y + 1);
});

test('landscape: the prompt banner does not overlap the Pen options', async ({ page }) => {
	const vp = page.viewportSize()!;
	test.skip(vp.width <= vp.height, 'landscape only');
	await openBoard(page);
	const banner = (await page.getByTestId('draw-prompt-banner').boundingBox())!;
	for (const id of ['draw-options-title', 'draw-more-colors']) {
		const box = (await page.getByTestId(id).boundingBox())!;
		const apart = banner.y + banner.height <= box.y + 1 || box.y + box.height <= banner.y + 1;
		expect(apart, `${id} overlaps the banner`).toBe(true);
	}
});
