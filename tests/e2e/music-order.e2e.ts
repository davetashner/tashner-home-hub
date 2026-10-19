import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

test('Settings > Music: a slow earlier save does not undo a later tap @J10.4', async ({ page }) => {
	const run = Date.now().toString(36);
	let config = { playlists: [], volumeCap: 70, timerMinutes: 0, device: null as string | null };
	const saved: Record<string, unknown>[] = [];
	let open!: () => void;
	const gate = new Promise<void>((r) => (open = r));
	let first = true;
	await page.route('**/api/spotify/status', (r) =>
		r.fulfill({ json: { state: 'connected', displayName: 'Pat Example' } })
	);
	await page.route('**/api/music/library', (r) => r.fulfill({ json: [] }));
	await page.route('**/api/music/devices', (r) =>
		r.fulfill({ json: [{ id: 'd1', name: `Phone ${run}` }] })
	);
	await page.route('**/api/music/settings', async (r) => {
		if (r.request().method() === 'PUT') {
			const patch = r.request().postDataJSON() as Record<string, unknown>;
			saved.push(patch);
			config = { ...config, ...patch } as typeof config;
			const reply = { ...config };
			if (first) {
				first = false;
				await gate;
			}
			return r.fulfill({ json: reply });
		}
		return r.fulfill({ json: config });
	});
	await signInAsAdult(page, 'e2e-music-adult');
	await gotoHydrated(page, '/settings/music');

	await page.getByRole('button', { name: '15 min' }).click();
	const phone = page.getByRole('button', { name: `Phone ${run}` });
	await phone.click();
	await expect(phone).toHaveAttribute('aria-pressed', 'true');
	// Let the older reply land after the later tap.
	await page.waitForTimeout(300);
	open();
	await expect.poll(() => saved.length).toBe(2);
	await expect(phone).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('button', { name: '15 min' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(saved).toEqual([{ timerMinutes: 15 }, { device: `Phone ${run}` }]);
});
