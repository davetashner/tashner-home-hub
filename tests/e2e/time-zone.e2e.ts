import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

/**
 * The household zone is global state shared by every test running against this server, so
 * these tests only ever see a pinned zone and never save one: the PUT is answered here.
 */
async function pinZone(page: Page, timeZone: string, saved: unknown[] = []) {
	await page.route('**/api/settings/household', (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { timeZone } });
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: route.request().postDataJSON() });
	});
}

test('grown-ups find and pick the household time zone @J9.7', async ({ page }) => {
	const saved: unknown[] = [];
	await pinZone(page, 'America/Chicago', saved);
	await signInAsAdult(page, 'e2e-tz-adult');
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Time zone/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Time zone' })).toBeVisible();
	await expect(page.getByTestId('tz-current')).toHaveText('Chicago');

	const zones = page.getByRole('list', { name: 'Time zones' });
	await expect(zones.getByRole('button', { name: /Chicago/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await page.getByRole('searchbox', { name: 'Find a city or region' }).fill('tokyo');
	const tokyo = zones.getByRole('button', { name: /Tokyo/ });
	await expectTappable(tokyo);
	await tokyo.click();
	await expect(page.getByTestId('tz-current')).toHaveText('Tokyo');
	await expect(tokyo).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => saved).toEqual([{ timeZone: 'Asia/Tokyo' }]);

	await page.getByRole('searchbox', { name: 'Find a city or region' }).fill('zzzz');
	await expect(zones).toContainText('No time zone matches');
});

test('a failed save puts the old zone back @J9.7', async ({ page }) => {
	await pinZone(page, 'Europe/London');
	await page.route('**/api/settings/household', (route) =>
		route.request().method() === 'PUT' ? route.fulfill({ status: 500 }) : route.fallback()
	);
	await signInAsAdult(page, 'e2e-tz-adult');
	await gotoHydrated(page, '/settings/time-zone');
	await expect(page.getByTestId('tz-current')).toHaveText('London');
	await page
		.getByRole('list', { name: 'Time zones' })
		.getByRole('button', { name: /Paris/ })
		.click();
	await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.');
	await expect(page.getByTestId('tz-current')).toHaveText('London');
});

test('the time zone page fits a phone without sideways scrolling @J9.7', async ({ page }) => {
	await pinZone(page, 'America/Chicago');
	await page.setViewportSize({ width: 390, height: 844 });
	await signInAsAdult(page, 'e2e-tz-adult');
	await gotoHydrated(page, '/settings/time-zone');
	await expect(page.getByTestId('tz-current')).toHaveText('Chicago');
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('a late household load does not undo the zone the adult picked @J9.7', async ({ page }) => {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	let held = 0;
	await page.route('**/api/settings/household', async (route) => {
		const method = route.request().method();
		if (method === 'GET') {
			held++;
			await gate;
			return route.fulfill({ json: { timeZone: 'Europe/London' } });
		}
		return route.fulfill({ json: route.request().postDataJSON() });
	});
	await signInAsAdult(page, 'e2e-tz-adult');
	await gotoHydrated(page, '/settings/time-zone');
	await expect.poll(() => held).toBeGreaterThan(0);
	const zones = page.getByRole('list', { name: 'Time zones' });
	await page.getByRole('searchbox', { name: 'Find a city or region' }).fill('tokyo');
	await zones.getByRole('button', { name: /Tokyo/ }).click();
	await expect(page.getByTestId('tz-current')).toHaveText('Tokyo');
	release();
	// Let the held response land, then the pick must still stand.
	await page.waitForTimeout(300);
	await expect(page.getByTestId('tz-current')).toHaveText('Tokyo');
});
