import { expect, test, type Locator } from '@playwright/test';
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
	// A body background would paint over the layer (hub-hq2).
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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

// The sunset windows are unit-tested on the pure functions; seeding a location here would change
// a setting shared with the other specs.
test('Auto draws a valid palette, and a picked palette applies and resets', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-wave-auto-${info.project.name}`);
	// No holiday, whatever the date the suite runs on.
	await page.goto('/settings/background?season=none');
	const bg = page.getByTestId('wave-background');
	const valid = /^(dusk|sorbet)$/;
	await expect(bg).toHaveAttribute('data-palette', valid);
	await expect(async () => {
		await page.getByRole('button', { name: 'Seafoam' }).click();
		await expect(bg).toHaveAttribute('data-palette', 'seafoam', { timeout: 500 });
	}).toPass();
	await expect(async () => {
		await page.getByRole('button', { name: 'Auto' }).click();
		await expect(bg).toHaveAttribute('data-palette', valid, { timeout: 500 });
	}).toPass();
});

// The calendar is unit-tested; `?season=` pins a holiday the way a preview does (hub-6pv.6).
test('a pinned holiday takes over Auto', async ({ page }) => {
	await page.goto('/?season=halloween');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toHaveAttribute('data-season', 'halloween');
	await expect(bg).toHaveAttribute('data-palette', /^halloween(-night)?$/);
	await page.goto('/?season=none');
	await expect(bg).toHaveAttribute('data-season', 'none');
	await expect(bg).toHaveAttribute('data-palette', /^(dusk|sorbet|night)$/);
});

// hub-6pv.6.2: holiday pictures ride on the wave layer and never take a tap.
test('Halloween brings pumpkins, bats and a ghost; a plain day brings none', async ({ page }) => {
	await page.goto('/?season=halloween');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer).toHaveAttribute('data-season', 'halloween');
	await expect(layer).toHaveCSS('pointer-events', 'none');
	for (const id of ['jack-tall', 'jack-round', 'pumpkin', 'ghost', 'bat-1', 'bat-2']) {
		await expect(layer.locator(`[data-sprite="${id}"]`)).toHaveCount(1);
	}
	await expect
		.poll(() =>
			layer
				.locator('[data-sprite="jack-round"] img')
				.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
		)
		.toBe(true);
	await page.goto('/?season=none');
	await expect(page.getByTestId('wave-background')).toHaveAttribute('data-season', 'none');
	await expect(page.getByTestId('seasonal-layer')).toHaveCount(0);
	await expect(page.locator('img[src^="/seasons/"]')).toHaveCount(0);
});

test('this device can hide the waves and remembers it', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wave-device-${info.project.name}`);
	await page.goto('/settings/background');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toHaveAttribute('data-device', 'show');
	const device = page.getByRole('group', { name: 'On this device' });
	await device.getByRole('button', { name: 'Not on this device' }).click();
	await expect(bg).toHaveAttribute('data-device', 'off');
	await expect(bg.locator('canvas')).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('hub.wave.device'))).toBe('off');
	await page.reload();
	await expect(bg).toHaveAttribute('data-device', 'off');
	await page
		.getByRole('group', { name: 'On this device' })
		.getByRole('button', { name: 'Show here' })
		.click();
	await expect(bg).toHaveAttribute('data-device', 'show');
	expect(await page.evaluate(() => localStorage.getItem('hub.wave.device'))).toBeNull();
});
