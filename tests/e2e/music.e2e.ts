import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.beforeAll(ensureHousehold);

test('Settings > Music says Spotify is not set up when there is no client id', async ({ page }) => {
	await page.route('**/api/spotify/status', (r) =>
		r.fulfill({ json: { state: 'not_configured' } })
	);
	await signInAsAdult(page, 'e2e-music-adult');
	await page.goto('/settings/music');
	await expect(page.getByTestId('spotify-state')).toHaveText("Spotify isn't set up");
	await expect(page.getByText('docs/setup/spotify.md')).toBeVisible();
});

test('Connect Spotify is a big tap target and Connected shows the name with Disconnect', async ({
	page
}) => {
	let state: object = { state: 'disconnected' };
	await page.route('**/api/spotify/status', (r) => r.fulfill({ json: state }));
	await page.route('**/api/spotify/disconnect', (r) =>
		r.fulfill({ json: { state: 'disconnected' } })
	);
	await signInAsAdult(page, 'e2e-music-adult');
	await page.goto('/settings/music');
	const connect = page.getByTestId('spotify-connect');
	await expect(connect).toBeVisible();
	await expectTappable(connect);

	state = { state: 'connected', displayName: 'Pat Example' };
	await page.reload();
	await expect(page.getByTestId('spotify-state')).toHaveText('Connected as Pat Example');
	await page.getByRole('button', { name: 'Disconnect' }).click();
	await expect(connect).toBeVisible();
});
