import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const MIN = 60_000;
const HOME = /:\d+\/$/;

/** Pins this page's idle timers so other tests' settings never leak in; nothing is saved. */
async function idleSettings(page: Page, homeMinutes: number, frameMinutes: number) {
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes, frameMinutes } })
			: route.fallback()
	);
}

test('idle returns home, then starts the photo frame; a touch goes back home', async ({ page }) => {
	await idleSettings(page, 2, 5);
	// An empty library keeps the nav visible under the frame (slideshow.e2e.ts covers the fullscreen frame).
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: [] }));
	await page.clock.install();
	await page.goto('/meals');
	await page.waitForLoadState('networkidle');

	await page.clock.fastForward(MIN);
	await page.getByRole('heading', { level: 1, name: 'Meals' }).click();
	await page.clock.fastForward(2 * MIN - 1000);
	await expect(page).toHaveURL(/\/meals$/);

	await page.clock.fastForward(1000);
	await expect(page).toHaveURL(HOME);

	await page.clock.fastForward(3 * MIN);
	await expect(page).toHaveURL(/\/photos$/);

	// The waking tap only wakes: it must not also follow the link underneath.
	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' })
		.click();
	await expect(page).toHaveURL(HOME);
});

test('the photo frame returns to the screen it interrupted when going home is off', async ({
	page
}) => {
	await idleSettings(page, 0, 1);
	await page.clock.install();
	await page.goto('/lists');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(MIN);
	await expect(page).toHaveURL(/\/photos$/);
	await page.keyboard.press('Space');
	await expect(page).toHaveURL(/\/lists$/);
});

test('grown-ups set the idle timers on the Screen settings page', async ({ page }) => {
	await idleSettings(page, 2, 5);
	const saved: unknown[] = [];
	await page.route('**/api/settings/idle', (route) => {
		if (route.request().method() !== 'PUT') return route.fallback();
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: { homeMinutes: 3, frameMinutes: 5 } });
	});
	await signInAsAdult(page, 'e2e-idle-adult');
	await page.goto('/settings');
	await page.getByRole('link', { name: /Screen/ }).click();
	await expect(page.getByTestId('homeMinutes')).toHaveText('2 minutes');
	await expect(page.getByTestId('frameMinutes')).toHaveText('5 minutes');

	const more = page.getByRole('button', { name: 'Back to home: more' });
	await expectTappable(more);
	await expectTappable(page.getByRole('button', { name: 'Photo frame: less' }));
	await more.click();
	await expect(page.getByTestId('homeMinutes')).toHaveText('3 minutes');
	await expect.poll(() => saved).toEqual([{ homeMinutes: 3 }]);
});
