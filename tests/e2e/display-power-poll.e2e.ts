import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { asWallDisplay } from './display';
import { gotoHydrated } from './hydrated';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

// hub-xcr.7: one shared 1 s poll for the wake guard and the night clock, wall displays only.
async function countPolls(page: import('@playwright/test').Page, ms: number): Promise<number> {
	let count = 0;
	await page.route('**/api/display/power', (route) => {
		count++;
		return route.fulfill({ json: { power: 'on', reason: 'schedule', mode: 'normal' } });
	});
	await gotoHydrated(page, '/');
	await page.waitForLoadState('networkidle');
	count = 0;
	await page.waitForTimeout(ms);
	return count;
}

test('a wall display polls the display power about once a second, not twice @J8.5', async ({
	page,
	context
}) => {
	await asWallDisplay(context);
	const polls = await countPolls(page, 5000);
	expect(polls).toBeGreaterThanOrEqual(3);
	expect(polls).toBeLessThanOrEqual(7);
});

test('a personal device never polls the display power @J8.5', async ({ page }) => {
	expect(await countPolls(page, 3000)).toBe(0);
});
