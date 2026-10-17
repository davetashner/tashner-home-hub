import { expect, test, type Page } from '@playwright/test';
import { zonedInstant } from '../../src/lib/domain/display-power';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';

test.beforeAll(ensureHousehold);

/** The household's own wall-clock time on a fixed summer weekday, so the test never depends on the host zone. */
async function localInstant(page: Page, hour: number): Promise<Date> {
	const { timeZone } = await (await page.request.get('/api/settings/household')).json();
	return new Date(zonedInstant(timeZone, 2030, 6, 12, hour * 60));
}

const html = (page: Page) => page.locator('html');
const overlay = (page: Page) => page.getByTestId('dim-overlay');

// The shared server's saved appearance never changes here: saves are answered by the test.
test.beforeEach(async ({ page }) => {
	// Every other spec sees a pinned look (light, no dimming); this one tests the live evening look.
	await page.addInitScript(() => {
		(window as unknown as { __hubLiveAppearance: boolean }).__hubLiveAppearance = true;
	});
	await page.route('**/api/settings/appearance', (route) =>
		route.request().method() === 'PUT' ? route.fulfill({ json: {} }) : route.continue()
	);
});

test('Auto is light at noon and night in the evening, and the wall dims in the evening', async ({
	page,
	context
}) => {
	await asWallDisplay(context);
	await page.clock.install({ time: await localInstant(page, 12) });
	await page.goto('/');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await expect(overlay(page)).toHaveCSS('opacity', '0');

	// The once-a-minute tick picks up the evening: no reload, no network.
	await page.clock.fastForward('10:00:00');
	await expect(html(page)).toHaveAttribute('data-theme', 'night');
	await expect(overlay(page)).toHaveCSS('opacity', '0.2');
});

test('without the test seam, an automated browser is pinned to light and undimmed', async ({
	page,
	context
}) => {
	await asWallDisplay(context);
	await page.addInitScript(() => {
		(window as unknown as { __hubLiveAppearance: boolean }).__hubLiveAppearance = false;
	});
	await page.clock.install({ time: await localInstant(page, 22) });
	await page.goto('/');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await expect(overlay(page)).toHaveCSS('opacity', '0');
});

test('a personal device is not dimmed in the evening', async ({ page }) => {
	await page.clock.install({ time: await localInstant(page, 22) });
	await page.goto('/');
	await expect(html(page)).toHaveAttribute('data-theme', 'night');
	await expect(overlay(page)).toHaveCount(0);
});

test('a grown-up picks Dark, then Light, and it applies at once', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-appearance-adult-${info.project.name}`);
	await page.clock.install({ time: await localInstant(page, 12) });
	await page.goto('/settings/appearance');
	const group = page.getByRole('group', { name: 'Theme' });
	await expect(async () => {
		await group.getByRole('button', { name: 'Dark' }).click();
		await expect(html(page)).toHaveAttribute('data-theme', 'night', { timeout: 1000 });
	}).toPass();
	await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
	await group.getByRole('button', { name: 'Light' }).click();
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await group.getByRole('button', { name: 'Auto' }).click();
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
});
