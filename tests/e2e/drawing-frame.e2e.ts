import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { asWallDisplay } from './display';
import { gotoHydrated } from './hydrated';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);
test.beforeEach(({ context }) => asWallDisplay(context));

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

/** A one-photo frame with one posted drawing, all served synthetically. Returns the drawing requests. */
async function stub(page: Page, drawings: 'on' | 'off', photoId: string) {
	await page.addInitScript(() => {
		Math.random = () => 0.999;
	});
	const wide = await syntheticJpeg(640, 360);
	const drawingRequests: string[] = [];
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
		if (id !== photoId) return route.fallback();
		return route.fulfill({ contentType: 'image/jpeg', body: wide });
	});
	await page.route('**/api/photo/slideshow?**', (route) =>
		route.fulfill({ json: [{ id: photoId, w: 640, h: 360 }] })
	);
	await page.route('**/api/photo/drawings', (route) => {
		drawingRequests.push(route.request().url());
		return route.fulfill({
			json: [{ id: 'note-1', name: 'Ada', src: '/api/notes/note-1/image?v=1' }]
		});
	});
	await page.route('**/api/notes/note-1/image?**', (route) =>
		route.fulfill({ contentType: 'image/png', body: PNG })
	);
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 10, transition: 'fade', drawings } })
			: route.fallback()
	);
	return drawingRequests;
}

test('a posted drawing joins the frame with the artist name when the setting is on', async ({
	page
}, info) => {
	const photoId = `${info.project.name}-drawing-frame`;
	await stub(page, 'on', photoId);
	await page.clock.install();
	await gotoHydrated(page, '/photos');
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', photoId);
	await expect(page.getByTestId('drawing-caption')).toHaveCount(0);

	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', 'drawing:note-1');
	await expect(page.getByTestId('drawing-caption')).toHaveText('Drawn by Ada');
	await expect(front.locator('[data-part="main"]')).toHaveCSS('object-fit', 'contain');

	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', photoId);
});

test('drawings stay out of the frame, and are never requested, by default', async ({
	page
}, info) => {
	const photoId = `${info.project.name}-drawing-off`;
	const requests = await stub(page, 'off', photoId);
	await page.clock.install();
	await gotoHydrated(page, '/photos');
	const front = page.getByTestId('slideshow').locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', photoId);
	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', photoId);
	expect(requests).toHaveLength(0);
});
