import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('a grown-up sets the screen direction and the display endpoint reports it @J9.5', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-orientation-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Orientation/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Orientation' })).toBeVisible();

	const turned = page.getByRole('button', { name: 'Turned left', exact: true });
	await expectTappable(turned);
	await turned.click();
	await expect(turned).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('orientation-summary')).toContainText('set up portrait');
	await expect
		.poll(async () => (await page.request.get('/api/display/orientation')).json())
		.toEqual({ rotation: '90', orientation: 'portrait' });

	// Put the shared server back to landscape for the other tests.
	await page.getByRole('button', { name: 'Normal', exact: true }).click();
	await expect
		.poll(async () => (await page.request.get('/api/display/orientation')).json())
		.toEqual({ rotation: 'normal', orientation: 'landscape' });
});

test('signed-out callers cannot change the direction @J9.5', async ({ request }) => {
	const res = await request.put('/api/settings/orientation', { data: { rotation: '180' } });
	expect(res.status()).toBe(401);
});
