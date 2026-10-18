import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

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

test('the page links the manifest, touch icon and Home Screen title', async ({ page }) => {
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

test('the manifest opens standalone with any and maskable icons', async ({ request }) => {
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

test('the touch icon is the 180px size iOS asks for', async ({ request }) => {
	expect(await pngSize(request, '/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
});
