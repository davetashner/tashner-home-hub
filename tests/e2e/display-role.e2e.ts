import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { gotoHydrated, reloadHydrated } from './hydrated';

// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const MIN = 60_000;

async function idleSettings(page: Page) {
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 2, frameMinutes: 5 } })
			: route.fallback()
	);
	// An empty library keeps the nav visible under the frame.
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: [] }));
}

test('a personal device (the default) never goes home or shows the photo frame', async ({
	page
}) => {
	await idleSettings(page);
	await page.clock.install();
	await gotoHydrated(page, '/meals');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(30 * MIN);
	await expect(page).toHaveURL(/\/meals$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Meals' })).toBeVisible();
});

test('a wall display goes home and shows the photo frame when idle', async ({ page, context }) => {
	await asWallDisplay(context);
	await idleSettings(page);
	await page.clock.install();
	await gotoHydrated(page, '/meals');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(2 * MIN);
	await expect(page).toHaveURL(/:\d+\/$/);
	await page.clock.fastForward(3 * MIN);
	await expect(page).toHaveURL(/\/photos$/);
});

test('?display=wall makes the device a wall, drops the query, and survives a reload', async ({
	page
}) => {
	await gotoHydrated(page, '/meals?display=wall');
	await expect(page).toHaveURL(/\/meals$/);
	expect(await (await page.request.get('/api/display/role')).json()).toEqual({ role: 'wall' });
	await reloadHydrated(page);
	expect(await (await page.request.get('/api/display/role')).json()).toEqual({ role: 'wall' });
	await gotoHydrated(page, '/meals?display=personal');
	expect(await (await page.request.get('/api/display/role')).json()).toEqual({
		role: 'personal'
	});
});

test('Settings > Screen switches this device between personal and wall', async ({ page }) => {
	// Once this is a wall display the wake guard follows the power state, so pin it on.
	await page.route('**/api/display/power', (route) =>
		route.fulfill({ json: { power: 'on', reason: 'schedule', mode: 'normal' } })
	);
	await signInAsAdult(page, 'e2e-display-role-adult');
	await gotoHydrated(page, '/settings/screen');
	await page.waitForLoadState('networkidle');
	const group = page.getByRole('group', { name: 'This device' });
	await expect(group.getByRole('button', { name: 'Personal' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	const saved = page.waitForResponse((r) => r.url().endsWith('/api/display/role'));
	// The page re-runs its loads after the save (invalidateAll); reloading mid-flight interrupts the frame.
	const refreshed = page.waitForResponse((r) => r.url().includes('__data.json'));
	await group.getByRole('button', { name: 'Wall display' }).click();
	await expect(group.getByRole('button', { name: 'Wall display' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect((await saved).ok()).toBe(true);
	await refreshed;
	await reloadHydrated(page);
	await expect(group.getByRole('button', { name: 'Wall display' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// A tap before the reloaded page hydrates is lost, so wait for it to settle first.
	await page.waitForLoadState('networkidle');
	await group.getByRole('button', { name: 'Personal' }).click();
	await expect(group.getByRole('button', { name: 'Personal' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('changing the role needs an adult session', async ({ request }) => {
	const res = await request.put('/api/display/role', { data: { role: 'wall' } });
	expect(res.status()).toBe(401);
});

test('the unlock page remembers by default on a personal device, not on a wall', async ({
	page,
	context
}) => {
	const box = () => page.getByRole('checkbox', { name: /stay unlocked/ });
	// With a single adult the unlock page may skip the picker and show the PIN screen directly.
	const pickAdult = async () => {
		const adult = page.getByRole('button', { name: 'Baseline Adult' });
		if (await adult.isVisible()) await adult.click();
		await expect(box()).toBeVisible();
	};
	await gotoHydrated(page, '/unlock?next=/settings');
	await expect(page.getByRole('button', { name: 'Baseline Adult' }).or(box())).toBeVisible();
	await pickAdult();
	await expect(box()).toBeChecked();

	await asWallDisplay(context);
	await gotoHydrated(page, '/unlock?next=/settings');
	await pickAdult();
	await expect(box()).not.toBeChecked();
});
