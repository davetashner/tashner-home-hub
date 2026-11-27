import { expect, test } from '@playwright/test';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
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

test('Show now opens the wall photo frame on the sent photo', async ({
	browser,
	context,
	page
}, info) => {
	// The wall: a kiosk on the home screen, listening for "Show now".
	await asWallDisplay(context);
	const listening = page.waitForRequest((r) => r.url().includes('/api/events?topics=frame'));
	await gotoHydrated(page, '/');
	await listening;

	// The phone: a grown-up's own browser.
	const phoneContext = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' });
	const phone = await phoneContext.newPage();
	await signInAsAdult(phone, `e2e-show-now-adult-${info.project.name}`);
	await gotoHydrated(phone, '/settings/send-photos');
	const uploaded = phone.waitForResponse((r) => r.url().endsWith('/api/photo-upload'));
	await phone.getByTestId('send-photos-input').setInputFiles({
		name: 'wall.jpg',
		mimeType: 'image/jpeg',
		buffer: await syntheticJpeg(80, 60)
	});
	const { photoId } = (await (await uploaded).json()) as { photoId: string };
	const show = phone.getByTestId('show-now');
	await expectTappable(show);
	const shown = phone.waitForResponse((r) => r.url().endsWith(`/api/photo/${photoId}/show`));
	await show.click();
	await expect(show).toHaveText('On the wall');
	expect((await shown).status()).toBe(200);

	await expect(page).toHaveURL(/\/photos$/);
	await expect(page.locator(`img[src*="/api/photo/${photoId}?"]`).first()).toBeVisible();
	await phoneContext.close();
});
