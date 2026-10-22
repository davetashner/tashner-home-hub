import { expect, test, type Locator } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated, reloadHydrated } from './hydrated';

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

test('the wave layer sits behind the home screen and never takes a tap @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(bg).toHaveAttribute('aria-hidden', 'true');
	await expect(bg).toHaveCSS('pointer-events', 'none');
	await expect(bg).toHaveCSS('z-index', '-1');
	await expect(drawn(bg)).toHaveCount(0);
	// A body background would paint over the layer (hub-hq2).
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('reduced motion still shows the background @J0.2', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await gotoHydrated(page, '/');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(drawn(bg)).toHaveCount(0);
});

test('a grown-up turns the background off and back on @J9.6', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wave-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings/background');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await page.getByRole('button', { name: 'Off' }).click();
	await expect(bg).toHaveCount(0);
	await page.getByRole('button', { name: 'Sorbet' }).click();
	await expect(bg).toBeAttached();
});

// The sunset windows are unit-tested on the pure functions; seeding a location here would change
// a setting shared with the other specs.
test('Auto draws a valid palette, and a picked palette applies and resets @J9.6', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-wave-auto-${info.project.name}`);
	// No holiday, whatever the date the suite runs on.
	await gotoHydrated(page, '/settings/background?season=none');
	const bg = page.getByTestId('wave-background');
	const valid = /^(dusk|sorbet)$/;
	await expect(bg).toHaveAttribute('data-palette', valid);
	await page.getByRole('button', { name: 'Seafoam' }).click();
	await expect(bg).toHaveAttribute('data-palette', 'seafoam');
	await page.getByRole('button', { name: 'Auto' }).click();
	await expect(bg).toHaveAttribute('data-palette', valid);
});

// The calendar is unit-tested; `?season=` pins a holiday the way a preview does (hub-6pv.6).
test('a pinned holiday takes over Auto @J9.6', async ({ page }) => {
	await gotoHydrated(page, '/?season=halloween');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toHaveAttribute('data-season', 'halloween');
	await expect(bg).toHaveAttribute('data-palette', /^halloween(-night)?$/);
	await gotoHydrated(page, '/?season=none');
	await expect(bg).toHaveAttribute('data-season', 'none');
	await expect(bg).toHaveAttribute('data-palette', /^(dusk|sorbet|night)$/);
});

// hub-6pv.6.2: holiday pictures ride on the wave layer and never take a tap.
test('Halloween brings pumpkins, bats and a ghost; a plain day brings none @J0.2', async ({
	page
}) => {
	await gotoHydrated(page, '/?season=halloween');
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
	await gotoHydrated(page, '/?season=none');
	await expect(page.getByTestId('wave-background')).toHaveAttribute('data-season', 'none');
	await expect(page.getByTestId('seasonal-layer')).toHaveCount(0);
	await expect(page.locator('img[src^="/seasons/"]')).toHaveCount(0);
});

// hub-6pv.6.3: one reindeer joins the herd each day from Dec 16; Rudolph comes last.
test('the reindeer countdown shows one reindeer per day so far @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/?season=christmas&reindeer=3');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer.locator('[data-sprite^="reindeer-"]')).toHaveCount(3);
	await expect(layer.locator('[data-sprite="reindeer-rudolph"]')).toHaveCount(0);
	await gotoHydrated(page, '/?season=christmas&reindeer=9');
	await expect(layer.locator('[data-sprite^="reindeer-"]')).toHaveCount(9);
	await expect
		.poll(() =>
			layer
				.locator('[data-sprite="reindeer-rudolph"] img')
				.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
		)
		.toBe(true);
});

// hub-6pv.6.4: Christmas Eve snows, and Santa's whole team crosses the sky.
test('Christmas Eve brings snow, pines and the sleigh with all nine @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/?season=christmas-eve');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer.getByTestId('snow')).toHaveCount(1);
	await expect(layer.locator('[data-sprite="sleigh"]')).toHaveCount(1);
	await expect(layer.locator('[data-sprite^="team-"]')).toHaveCount(9);
	await expect(layer.locator('[data-sprite^="pine-"]')).not.toHaveCount(0);
	await expect(layer.locator('[data-sprite^="reindeer-"]')).toHaveCount(0);
});

// hub-6pv.6.6: Christmas Day is the tree and presents by the fire.
test('Christmas Day shows the tree and the fire @J0.2', async ({ page }) => {
	await gotoHydrated(page, '/?season=christmasday');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer).toHaveAttribute('data-season', 'christmasday');
	for (const id of ['tree', 'fireplace']) {
		await expect(layer.locator(`[data-sprite="${id}"]`)).toHaveCount(1);
	}
});

// hub-6pv.6.5: St Patrick's rainbow, pot of gold and dancing leprechauns.
test("St Patrick's Day shows a rainbow, a pot of gold and leprechauns @J0.2", async ({ page }) => {
	await gotoHydrated(page, '/?season=stpatricks');
	const layer = page.getByTestId('seasonal-layer');
	for (const id of ['rainbow', 'pot-of-gold', 'leprechaun-1', 'leprechaun-2']) {
		await expect(layer.locator(`[data-sprite="${id}"]`)).toHaveCount(1);
	}
});

// hub-6pv.6.9: Thanksgiving week is a turkey, a football, a pie, leaves and a goal post.
test('Thanksgiving week shows a turkey, a football, a pie and a goal post @J0.2', async ({
	page
}) => {
	await gotoHydrated(page, '/?season=thanksgiving');
	await expect(page.getByTestId('wave-background')).toHaveAttribute('data-season', 'thanksgiving');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer).toHaveAttribute('data-season', 'thanksgiving');
	for (const id of ['turkey', 'football', 'pie', 'leaves', 'goalpost']) {
		await expect(layer.locator(`[data-sprite="${id}"]`)).toHaveCount(1);
	}
});

// hub-6pv.6.10: the birthday scene is a cake, a unicorn and rising balloons; the resting cake
// sits below the Notes row and never covers a card or a button.
test('the birthday scene shows a cake, a unicorn and balloons clear of the cards @J0.2', async ({
	page
}) => {
	await gotoHydrated(page, '/?season=birthday');
	await expect(page.getByTestId('wave-background')).toHaveAttribute('data-season', 'birthday');
	const layer = page.getByTestId('seasonal-layer');
	await expect(layer).toHaveAttribute('data-season', 'birthday');
	for (const id of ['cake', 'unicorn', 'balloons', 'balloon-1', 'balloon-2', 'balloon-3']) {
		await expect(layer.locator(`[data-sprite="${id}"]`)).toHaveCount(1);
	}
	await expect(layer.locator('[data-sprite="unicorn"] img')).toHaveCount(2);
	await expect(layer.locator('[data-sprite="balloon-1"]')).toHaveCSS('opacity', /^[01](\.\d+)?$/);
	const cake = (await layer.locator('[data-sprite="cake"]').boundingBox())!;
	const notes = await page.getByTestId('home-notes').boundingBox();
	if (notes) expect(cake.y).toBeGreaterThanOrEqual(notes.y + notes.height - 1);
	// The cake stays on screen.
	const view = page.viewportSize()!;
	expect(cake.y + cake.height).toBeLessThanOrEqual(view.height + 1);
	expect(cake.x + cake.width).toBeLessThanOrEqual(view.width + 1);
});

test('this device can hide the waves and remembers it @J9.6', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wave-device-${info.project.name}`);
	await gotoHydrated(page, '/settings/background');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toHaveAttribute('data-device', 'show');
	const device = page.getByRole('group', { name: 'On this device' });
	await device.getByRole('button', { name: 'Not on this device' }).click();
	await expect(bg).toHaveAttribute('data-device', 'off');
	await expect(bg.locator('canvas')).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('hub.wave.device'))).toBe('off');
	await reloadHydrated(page);
	await expect(bg).toHaveAttribute('data-device', 'off');
	await page
		.getByRole('group', { name: 'On this device' })
		.getByRole('button', { name: 'Show here' })
		.click();
	await expect(bg).toHaveAttribute('data-device', 'show');
	expect(await page.evaluate(() => localStorage.getItem('hub.wave.device'))).toBeNull();
});
