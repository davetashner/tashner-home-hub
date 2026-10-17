import { expect, test, type Locator } from '@playwright/test';
import { sunTimes } from '../../src/lib/domain/wave-background';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);
// The shared server's saved choice never changes here: saves are answered by the test.
test.beforeEach(({ page }) =>
	page.route('**/api/settings/wave-background', (route) =>
		route.request().method() === 'PUT' ? route.fulfill({ json: {} }) : route.continue()
	)
);

// Headless Chromium only has a CPU renderer, which the background refuses (it would starve the
// page), so it shows the still gradient here; on a real GPU the canvas must have drawn.
const drawn = (bg: Locator) => bg.locator('canvas[data-drawn=false]');

test('the wave layer sits behind the home screen and never takes a tap', async ({ page }) => {
	await page.goto('/');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(bg).toHaveAttribute('aria-hidden', 'true');
	await expect(bg).toHaveCSS('pointer-events', 'none');
	await expect(bg).toHaveCSS('z-index', '-1');
	await expect(drawn(bg)).toHaveCount(0);
});

test('reduced motion still shows the background', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(drawn(bg)).toHaveCount(0);
});

test('a grown-up turns the background off and back on', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wave-adult-${info.project.name}`);
	await page.goto('/settings/background');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(async () => {
		await page.getByRole('button', { name: 'Off' }).click();
		await expect(bg).toHaveCount(0, { timeout: 500 });
	}).toPass();
	await expect(async () => {
		await page.getByRole('button', { name: 'Sorbet' }).click();
		await expect(bg).toBeAttached({ timeout: 500 });
	}).toPass();
});

// Auto follows the sunset (hub-gj6.19). The place is near Delhi in June, where sunset falls
// mid-day UTC, so the calendar date is the same in any plausible household zone.
const PLACE = { lat: 28.6, lon: 77.2 };
const SUNSET = sunTimes(PLACE, 2024, 6, 21).sunset!;
const MIN = 60_000;

test('Auto is Sorbet around sunset and Dusk otherwise in the day theme, Night in the night theme', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-wave-sun-${info.project.name}`);
	const before = await page.request.get('/api/settings/weather');
	expect(before.ok()).toBe(true);
	const saved = (await before.json()).location;
	try {
		const put = await page.request.put('/api/settings/weather', {
			data: { ...PLACE, name: `e2e-wave-sun-${info.project.name}`, unit: 'C' }
		});
		expect(put.ok()).toBe(true);
		const palette = async (ms: number) => {
			await page.clock.setFixedTime(ms);
			await page.goto('/');
			return page.getByTestId('wave-background');
		};
		await expect(await palette(SUNSET - 50 * MIN)).toHaveAttribute('data-palette', 'dusk');
		await expect(await palette(SUNSET - 40 * MIN)).toHaveAttribute('data-palette', 'sorbet');
		await expect(await palette(SUNSET + 40 * MIN)).toHaveAttribute('data-palette', 'sorbet');
		const after = await palette(SUNSET + 50 * MIN);
		await expect(after).toHaveAttribute('data-palette', 'dusk');
		await page.evaluate(() => (document.documentElement.dataset.theme = 'night'));
		await expect(after).toHaveAttribute('data-palette', 'night');
		await page.evaluate(() => delete document.documentElement.dataset.theme);
		await expect(after).toHaveAttribute('data-palette', 'dusk');
	} finally {
		const restore = saved
			? await page.request.put('/api/settings/weather', { data: saved })
			: await page.request.delete('/api/settings/weather', {
					headers: { 'content-type': 'application/json' },
					data: '{}'
				});
		expect(restore.ok()).toBe(true);
	}
});
