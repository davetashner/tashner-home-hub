import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

// Google is never called: every /api/photo-import/google route is stubbed.
test('connect Google, start a picker import, see progress @J8.8', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-gimport-${info.project.name}`);
	let connected = false;
	let job: Record<string, unknown> | null = null;
	await page.route('**/api/photo-import/google', (r) => r.fulfill({ json: { connected, job } }));
	await page.route('**/api/photo-import/google/connect', (r) =>
		r.fulfill({ json: { url: 'https://accounts.example.test/consent', state: 's1' } })
	);
	await page.route('**/api/photo-import/google/finish', (r) => {
		connected = true;
		return r.fulfill({ status: 201, json: { connected } });
	});
	await page.route('**/api/photo-import/google/session', (r) => {
		job = {
			id: 'j1',
			status: 'importing',
			album: 'Beach',
			pickerUri: 'https://photos.example.test/pick',
			total: 4,
			done: 2,
			skipped: 0,
			failed: 0
		};
		return r.fulfill({ status: 201, json: job });
	});

	// A folder source so the form has somewhere to import to.
	await page.route('**/api/photo-sources', (r) =>
		r.request().method() === 'GET'
			? r.fulfill({
					json: [
						{
							id: 'src1',
							kind: 'folder',
							label: 'Stub lib',
							root: '/x',
							albums: [],
							photoCount: 0,
							lastScan: null
						}
					]
				})
			: r.continue()
	);
	await page.route('**/api/photo-sources/src1/images*', (r) => r.fulfill({ json: [] }));

	await gotoHydrated(page, '/settings/photo-library');
	const card = page.getByTestId('google-import');
	await expect(card).toContainText('Photos Picker API');
	await card.getByRole('button', { name: 'Connect Google Photos' }).click();
	await card.getByLabel(/Paste that page/).fill('http://127.0.0.1:9004/?code=abc&state=s1');
	await card.getByRole('button', { name: 'Finish connecting' }).click();
	await card.getByLabel('Album name').fill('Beach');
	await card.getByRole('button', { name: 'Start import' }).click();
	await expect(card.getByTestId('import-progress')).toHaveText('2 of 4 photos');
});
