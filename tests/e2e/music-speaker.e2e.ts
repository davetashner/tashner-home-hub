import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.beforeAll(ensureHousehold);

const MAC = 'AA:BB:CC:DD:EE:01';

test('Settings > Music > Speaker explains the setup when the hub cannot reach the Pi', async ({
	page
}) => {
	await signInAsAdult(page, 'e2e-speaker-adult');
	await page.goto('/settings/music');
	// No HUB_KIOSK_SPEAKER_* in the e2e server: the real route answers not_configured.
	await expect(page.getByTestId('speaker-state')).toHaveText(
		'The hub is not set up to reach the wall display'
	);
	await expect(page.getByText('HUB_KIOSK_SPEAKER_URL')).toBeVisible();
	await expect(page.getByTestId('speaker-scan')).toHaveCount(0);
});

test('Change speaker scans, pairs the picked speaker and plays a test sound', async ({ page }) => {
	let status: object = { state: 'none', mac: null, name: null, defaultSink: false };
	await page.route('**/api/music/speaker', (r) => r.fulfill({ json: status }));
	await page.route('**/api/music/speaker/scan', (r) =>
		r.fulfill({
			json: [
				{
					mac: MAC,
					name: 'Synthetic Speaker',
					kind: 'speaker',
					bars: 3,
					paired: false,
					connected: false
				},
				{
					mac: 'AA:BB:CC:DD:EE:02',
					name: 'Synthetic Phone',
					kind: 'phone',
					bars: 4,
					paired: false,
					connected: false
				}
			]
		})
	);
	await page.route('**/api/music/speaker/use', (r) => {
		status = { state: 'connected', mac: MAC, name: 'Synthetic Speaker', defaultSink: true };
		return r.fulfill({ json: status });
	});
	await page.route('**/api/music/speaker/test', (r) =>
		r.fulfill({ status: 409, json: { code: 'failed', message: 'The speaker is not connected.' } })
	);

	await signInAsAdult(page, 'e2e-speaker-adult');
	await page.goto('/settings/music');
	await expect(page.getByTestId('speaker-state')).toHaveText('No speaker yet');
	const find = page.getByTestId('speaker-scan');
	await expectTappable(find);
	await find.click();

	const rows = page.getByTestId('speaker-devices').getByRole('listitem');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(1)).toContainText('Not a speaker');
	await expect(page.getByRole('img', { name: 'Signal 3 of 4' })).toBeVisible();
	const useIt = page.getByTestId('speaker-use');
	await expect(useIt).toHaveCount(1);
	await expectTappable(useIt);
	await useIt.click();

	await expect(page.getByTestId('speaker-state')).toHaveText('Connected to Synthetic Speaker');
	await expect(page.getByTestId('speaker-devices')).toHaveCount(0);
	await expect(find).toHaveText('Change speaker');
	await page.getByTestId('speaker-test').click();
	await expect(page.getByRole('alert')).toHaveText('The speaker is not connected.');
});
