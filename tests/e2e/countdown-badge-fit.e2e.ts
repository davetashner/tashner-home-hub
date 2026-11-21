import { expect, test, type Locator } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

// The day circle on Home countdowns must hold its text on every screen, including the 4K wall
// (3840x2160 at 1x), where the type tokens reach their largest sizes.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const today = '2043-03-07';
const SIZES = [
	{ width: 3840, height: 2160 },
	{ width: 2160, height: 3840 },
	{ width: 1920, height: 1080 }
];

/** Every corner of each text line sits inside the circle (with a 1px allowance). */
async function textFits(badge: Locator) {
	return badge.evaluate((el) => {
		const c = el.getBoundingClientRect();
		const cx = c.left + c.width / 2;
		const cy = c.top + c.height / 2;
		const r = Math.min(c.width, c.height) / 2 + 1;
		const range = document.createRange();
		range.selectNodeContents(el);
		return [...range.getClientRects()].every((t) =>
			[
				[t.left, t.top],
				[t.right, t.top],
				[t.left, t.bottom],
				[t.right, t.bottom]
			].every(([x, y]) => Math.hypot(x - cx, y - cy) <= r)
		);
	});
}

test('Today and DAYS fit inside the countdown circle @J0.4', async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
	await page.route('**/api/countdowns', (route) =>
		route.fulfill({
			json: [
				{ id: 'a', title: 'Trip', targetDate: today, icon: null },
				{ id: 'b', title: 'Party', targetDate: '2043-03-21', icon: null }
			]
		})
	);
	for (const size of SIZES) {
		await page.setViewportSize(size);
		await gotoHydrated(page, '/');
		const badges = page.getByTestId('countdown-badge');
		await expect(badges).toHaveCount(2);
		await expect(badges.first()).toHaveText('Today');
		await expect(badges.nth(1)).toHaveText(/14\s*days/i);
		for (const badge of await badges.all()) {
			const box = (await badge.boundingBox())!;
			expect(Math.abs(box.width - box.height), `round at ${size.width}`).toBeLessThan(1);
			expect(await textFits(badge), `text fits at ${size.width}x${size.height}`).toBe(true);
		}
	}
});
