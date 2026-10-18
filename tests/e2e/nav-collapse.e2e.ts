import { expect, test } from '@playwright/test';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';
import { gotoHydrated, reloadHydrated } from './hydrated';

test.describe('collapsible nav rail', () => {
	test('collapse widens the content, survives reload, handle restores', async ({ page }) => {
		await gotoHydrated(page, '/photos');
		await page.waitForLoadState('networkidle');
		const viewport = page.viewportSize()!;
		if (viewport.height > viewport.width) {
			// Portrait keeps its bottom bar: no collapse control at all.
			await expect(page.getByTestId('nav-collapse')).toBeHidden();
			return;
		}
		const main = page.locator('main');
		const before = (await main.boundingBox())!;
		expect(before.width).toBeLessThan(viewport.width - 100);

		await page.getByTestId('nav-collapse').click();
		await expect(page.getByTestId('nav-handle')).toBeVisible();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(viewport.width, 0);
		// Edge to edge: the top bar left the grid too, so the content covers the full height.
		await expect
			.poll(async () => (await main.boundingBox())!.height)
			.toBeCloseTo(viewport.height, 0);
		expect((await main.boundingBox())!.y).toBeCloseTo(0, 0);
		await expect(page.locator('header')).toBeHidden();
		await expect(page.getByTestId('corner-clock-time')).toBeVisible();
		const handle = (await page.getByTestId('nav-handle').boundingBox())!;
		expect(handle.width).toBeGreaterThanOrEqual(96);
		expect(handle.height).toBeGreaterThanOrEqual(96);

		await reloadHydrated(page);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('nav-handle')).toBeVisible();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(viewport.width, 0);

		await page.getByTestId('nav-handle').click();
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
		await expect(page.locator('header')).toBeVisible();
		await expect(page.getByTestId('corner-clock')).toBeHidden();
		await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(before.width, 0);
	});

	test('on the photo frame the overlay clock stands alone and the handle stays clear of it', async ({
		page
	}, info) => {
		const viewport = page.viewportSize()!;
		// Portrait has no collapse.
		if (viewport.height > viewport.width) return;
		const jpeg = await syntheticJpeg(640, 360);
		const id = `${info.project.name}-collapse`;
		await page.route(/\/api\/photo\/[^/?]+\?/, (route) =>
			new URL(route.request().url()).searchParams.get('part') === 'bg'
				? route.fulfill({ status: 404 })
				: route.fulfill({ contentType: 'image/jpeg', body: jpeg })
		);
		await page.route('**/api/photo/slideshow?**', (route) =>
			route.fulfill({ json: [{ id, w: 640, h: 360 }] })
		);
		await page.addInitScript(() => localStorage.setItem('hub.nav.collapsed', '1'));
		await gotoHydrated(page, '/photos');
		await expect(page.getByTestId('overlay-time')).toBeVisible();
		await expect(page.getByTestId('nav-handle')).toBeVisible();
		await expect(page.getByTestId('corner-clock')).toHaveCount(0);

		// The handle hops to the top-left once the overlay reports in.
		await expect
			.poll(async () => (await page.getByTestId('nav-handle').boundingBox())!.y)
			.toBeLessThan(viewport.height / 2);
		const handle = (await page.getByTestId('nav-handle').boundingBox())!;
		for (const part of ['overlay-time', 'overlay-date']) {
			const box = (await page.getByTestId(part).boundingBox())!;
			const apart =
				handle.x + handle.width <= box.x ||
				box.x + box.width <= handle.x ||
				handle.y + handle.height <= box.y ||
				box.y + box.height <= handle.y;
			expect(apart, `${part} must not sit under the handle`).toBe(true);
		}
	});
});
