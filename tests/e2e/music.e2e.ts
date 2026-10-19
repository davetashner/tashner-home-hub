import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

test('Settings > Music says Spotify is not set up when there is no client id @J10.4', async ({
	page
}) => {
	await page.route('**/api/spotify/status', (r) =>
		r.fulfill({ json: { state: 'not_configured' } })
	);
	await signInAsAdult(page, 'e2e-music-adult');
	await gotoHydrated(page, '/settings/music');
	await expect(page.getByTestId('spotify-state')).toHaveText("Spotify isn't set up");
	await expect(page.getByText('docs/setup/spotify.md')).toBeVisible();
});

test('Connect Spotify is a big tap target and Connected shows the name with Disconnect @J10.4', async ({
	page
}) => {
	let state: object = { state: 'disconnected' };
	await page.route('**/api/spotify/status', (r) => r.fulfill({ json: state }));
	await page.route('**/api/spotify/disconnect', (r) =>
		r.fulfill({ json: { state: 'disconnected' } })
	);
	await signInAsAdult(page, 'e2e-music-adult');
	await gotoHydrated(page, '/settings/music');
	const connect = page.getByTestId('spotify-connect');
	await expect(connect).toBeVisible();
	await expectTappable(connect);

	state = { state: 'connected', displayName: 'Pat Example' };
	await reloadHydrated(page);
	await expect(page.getByTestId('spotify-state')).toHaveText('Connected as Pat Example');
	await page.getByRole('button', { name: 'Disconnect' }).click();
	await expect(connect).toBeVisible();
});

test('Settings > Music curates playlists and saves limits @J10.4', async ({ page }) => {
	const run = Date.now().toString(36);
	const lists = [
		{ id: 'pl1', name: `Wake up ${run}`, cover: null, tracks: 12 },
		{ id: 'pl2', name: `Bath time ${run}`, cover: null, tracks: 30 }
	];
	let config = {
		playlists: [lists[0]],
		volumeCap: 70,
		timerMinutes: 0,
		device: null as string | null
	};
	const saved: Record<string, unknown>[] = [];
	await page.route('**/api/spotify/status', (r) =>
		r.fulfill({ json: { state: 'connected', displayName: 'Pat Example' } })
	);
	await page.route('**/api/music/library', (r) => r.fulfill({ json: lists }));
	await page.route('**/api/music/devices', (r) =>
		r.fulfill({ json: [{ id: 'd1', name: `Phone ${run}` }] })
	);
	await page.route('**/api/music/settings', async (r) => {
		if (r.request().method() === 'PUT') {
			const patch = r.request().postDataJSON() as Record<string, unknown>;
			saved.push(patch);
			config = { ...config, ...patch } as typeof config;
		}
		await r.fulfill({ json: config });
	});
	await signInAsAdult(page, 'e2e-music-adult');
	await gotoHydrated(page, '/settings/music');

	const switches = page.getByTestId('playlist-switch');
	await expect(switches).toHaveCount(2);
	await expect(switches.nth(0)).toHaveAttribute('aria-checked', 'true');
	await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'false');
	await expectTappable(switches.nth(1));
	await switches.nth(1).click();
	await expect(switches.nth(1)).toHaveAttribute('aria-checked', 'true');
	expect((saved[0]!.playlists as unknown[]).length).toBe(2);

	await page.getByRole('button', { name: '15 min' }).click();
	await expect(page.getByRole('button', { name: '15 min' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: `Phone ${run}` }).click();
	await expect(page.getByRole('button', { name: `Phone ${run}` })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Saves go out in tap order, so the device save follows the timer one.
	await expect.poll(() => saved.at(-1)).toEqual({ device: `Phone ${run}` });
	await expect(page.getByTestId('cap-value')).toHaveText('70%');
});
