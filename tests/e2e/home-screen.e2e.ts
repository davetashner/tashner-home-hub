import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { fakeTimerApi } from './timers-api';
import type { KitchenTimer } from '../../src/lib/domain/timers';

// DEV-2: Add to Home Screen on iPhone and iPad opens the hub full screen with its own icon.
test.beforeAll(ensureHousehold);

/** Width and height from a PNG's IHDR chunk. */
async function pngSize(request: APIRequestContext, href: string) {
	const res = await request.get(href);
	expect(res.ok(), href).toBe(true);
	expect(res.headers()['content-type']).toBe('image/png');
	const bytes = await res.body();
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('the page links the manifest, touch icon and Home Screen title @J16.6', async ({ page }) => {
	await gotoHydrated(page, '/');
	const head = page.locator('head');
	// Compare resolved paths: the browser may report a link's href as an absolute URL.
	const path = (rel: string) =>
		head
			.locator(`link[rel="${rel}"]`)
			.evaluate((el) => new URL((el as HTMLLinkElement).href).pathname);
	expect(await path('manifest')).toBe('/manifest.webmanifest');
	expect(await path('apple-touch-icon')).toBe('/apple-touch-icon.png');
	await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
		'content',
		'Home Hub'
	);
	await expect(head.locator('meta[name="theme-color"]')).toHaveCount(1);
});

test('the manifest opens standalone with any and maskable icons @J16.6', async ({ request }) => {
	const res = await request.get('/manifest.webmanifest');
	expect(res.ok()).toBe(true);
	const manifest = await res.json();
	expect(manifest).toMatchObject({
		name: 'Home Hub',
		short_name: 'Home Hub',
		start_url: '/',
		scope: '/',
		display: 'standalone'
	});
	const icons: { src: string; sizes: string; purpose: string }[] = manifest.icons;
	expect(icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);
	for (const icon of icons) {
		const [w, h] = icon.sizes.split('x').map(Number);
		expect(await pngSize(request, icon.src), icon.src).toEqual({ width: w, height: h });
	}
});

test('the touch icon is the 180px size iOS asks for @J16.6', async ({ request }) => {
	expect(await pngSize(request, '/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
});

// TMR-1: phone, tablet and short layouts have no header Timers button; Home carries the entry.
test('every layout has one way to open Timers from Home and start a timer @J11.1', async ({
	page
}) => {
	const timers: KitchenTimer[] = [];
	await fakeTimerApi(page, timers);
	await gotoHydrated(page, '/');
	const entry = page.locator('[data-testid^="timer-open"]:visible');
	await expect(entry).toHaveCount(1);
	await entry.click();
	await page.getByTestId('timer-preset-5').click();
	await page.getByTestId('timer-start').click();
	await expect(page.getByTestId('timer-row')).toHaveCount(1);
	await page.getByTestId('timer-cancel').click();
	// The tap is optimistic: the request lands after the UI updates.
	await expect.poll(() => timers.length).toBe(0);
});
