import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

interface Photo {
	id: string;
	w: number;
	h: number;
}

/**
 * Serves this page its own synthetic photos and settings, so the shared test server's library
 * (other tests add and hide photos in parallel) never leaks in. Returns the photo ids requested.
 */
async function stubFrame(
	page: Page,
	photos: Photo[],
	settings = { intervalSeconds: 10, transition: 'kenburns' }
) {
	const tall = await syntheticJpeg(360, 640);
	const wide = await syntheticJpeg(640, 360);
	const requested: string[] = [];
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		const url = new URL(route.request().url());
		const id = decodeURIComponent(url.pathname.split('/').pop()!);
		const photo = photos.find((p) => p.id === id);
		if (!photo) return route.fallback();
		requested.push(id);
		const portrait = Number(url.searchParams.get('h')) > Number(url.searchParams.get('w'));
		// Like the server: a backdrop only exists when the photo's shape differs from the screen's.
		if (url.searchParams.get('part') === 'bg' && photo.h > photo.w === portrait)
			return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/jpeg', body: photo.h > photo.w ? tall : wide });
	});
	await page.route('**/api/photo/slideshow?**', (route) => route.fulfill({ json: photos }));
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: settings }) : route.fallback()
	);
	return requested;
}

const isPortrait = (page: Page) => {
	const v = page.viewportSize()!;
	return v.height > v.width;
};

test('the slideshow plays on the interval, preloads, and fills both photo shapes', async ({
	page
}, info) => {
	const tall = { id: `${info.project.name}-tall`, w: 360, h: 640 };
	const wide = { id: `${info.project.name}-wide`, w: 640, h: 360 };
	const requested = await stubFrame(page, [tall, wide]);
	await page.clock.install();
	await page.goto('/photos');

	const frame = page.getByTestId('slideshow');
	const front = frame.locator('[data-front="true"]');
	await expect(front).toHaveAttribute('data-photo-id', tall.id);
	await expect(frame).toHaveAttribute('data-transition', 'kenburns');
	await expect(front.locator('.kenburns')).toHaveCSS('animation-name', /kenburns/);
	// A portrait photo on a landscape screen sits on a blurred copy of itself, never cropped.
	await expect(front.locator('[data-part="bg"]')).toHaveCount(isPortrait(page) ? 0 : 1);
	await expect(front.locator('[data-part="main"]')).toHaveCSS('object-fit', 'contain');
	// The next photo is downloaded before its turn, so the change never shows a blank.
	await expect.poll(() => requested).toContain(wide.id);

	await page.clock.fastForward(9_000);
	await expect(front).toHaveAttribute('data-photo-id', tall.id);
	await page.clock.fastForward(1_000);
	await expect(front).toHaveAttribute('data-photo-id', wide.id);
	await expect(front.locator('[data-part="bg"]')).toHaveCount(isPortrait(page) ? 1 : 0);
	// The previous photo stays fully visible underneath while the new one fades in.
	await expect(frame.locator(`[data-photo-id="${tall.id}"]`)).toHaveCSS('opacity', '1');

	await page.clock.fastForward(10_000);
	await expect(front).toHaveAttribute('data-photo-id', tall.id);

	// Opened from the nav, the slideshow stays inside the shell so the nav still works.
	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' })
		.click();
	await expect(page).toHaveURL(/\/calendar$/);
});

test('the idle photo frame covers the whole screen; a touch goes back', async ({ page }, info) => {
	await stubFrame(page, [{ id: `${info.project.name}-idle`, w: 640, h: 360 }], {
		intervalSeconds: 30,
		transition: 'fade'
	});
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 0, frameMinutes: 1 } })
			: route.fallback()
	);
	await page.clock.install();
	await page.goto('/lists');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(60_000);
	await expect(page).toHaveURL(/\/photos$/);

	const frame = page.getByTestId('slideshow');
	await expect(frame.locator('[data-front="true"]')).toHaveAttribute(
		'data-photo-id',
		`${info.project.name}-idle`
	);
	const v = page.viewportSize()!;
	expect(await frame.boundingBox()).toEqual({ x: 0, y: 0, width: v.width, height: v.height });

	// A tap where the nav would be only wakes the screen.
	const box = (await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' })
		.boundingBox())!;
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page).toHaveURL(/\/lists$/);
});

test('an empty library explains how to add photos', async ({ page }) => {
	await stubFrame(page, []);
	await page.goto('/photos');
	await expect(page.getByText('No photos to show yet')).toBeVisible();
});
