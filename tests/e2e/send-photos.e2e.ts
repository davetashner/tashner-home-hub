import { expect, test } from '@playwright/test';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

// hub-5yt.1: a grown-up sends photos from a phone; they land in the "From phones" album.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('grown-ups send photos from a phone to the photo frame', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-send-photos-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Send photos Add photos/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Send photos' })).toBeVisible();

	const choose = page.locator('label', { hasText: 'Choose photos' });
	await expectTappable(choose);
	const jpg = await syntheticJpeg(64, 48);
	await page.getByTestId('send-photos-input').setInputFiles([
		{ name: 'one.jpg', mimeType: 'image/jpeg', buffer: jpg },
		{ name: 'two.jpg', mimeType: 'image/jpeg', buffer: jpg },
		{ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a photo') }
	]);
	await expect(page.getByTestId('send-photo')).toHaveCount(3);
	await expect(page.getByTestId('send-photos-summary')).toHaveText('2 of 3 sent, 1 not sent.');
	await expect(page.locator('[data-testid="send-photo"][data-status="failed"]')).toContainText(
		'That file is not a photo'
	);
	await expectTappable(page.getByRole('button', { name: 'Try again' }));

	const sources = (await (await page.request.get('/api/photo-sources')).json()) as {
		label: string;
		albums: { name: string; count: number }[];
	}[];
	const phones = sources.find((s) => s.label === 'From phones');
	expect(phones?.albums.find((a) => a.name === 'From phones')?.count).toBeGreaterThanOrEqual(2);
});
