import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);
// The shared server's saved choice never changes here: saves are answered by the test.
test.beforeEach(({ page }) =>
	page.route('**/api/settings/wave-background', (route) =>
		route.request().method() === 'PUT' ? route.fulfill({ json: {} }) : route.continue()
	)
);

test('the wave canvas sits behind the home screen and never takes a tap', async ({ page }) => {
	await page.goto('/');
	const bg = page.getByTestId('wave-background');
	await expect(bg).toBeAttached();
	await expect(bg.locator('canvas')).toHaveAttribute('data-drawn', 'true');
	await expect(bg).toHaveAttribute('aria-hidden', 'true');
	await expect(bg).toHaveCSS('pointer-events', 'none');
	await expect(bg).toHaveCSS('z-index', '-1');
});

test('reduced motion still draws one still frame', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await expect(page.getByTestId('wave-background').locator('canvas')).toHaveAttribute(
		'data-drawn',
		'true'
	);
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
	await page.getByRole('button', { name: 'Sorbet' }).click();
	await expect(bg.locator('canvas')).toHaveAttribute('data-palette', 'sorbet');
});
