import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';

// Home: the hero clock and the countdown pills share one row. A long countdown title must never
// squeeze the clock under the pills (the time clipped, the date wrapping) at any wall size.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const today = '2043-03-07';
const SIZES = [
	{ width: 1920, height: 1080 },
	{ width: 2560, height: 1440 },
	{ width: 3840, height: 2160 },
	{ width: 1080, height: 1920 },
	{ width: 1440, height: 2560 }
];

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.width - 1 &&
	b.x < a.x + a.width - 1 &&
	a.y < b.y + b.height - 1 &&
	b.y < a.y + a.height - 1;

/** How many lines the element's text takes. */
const lines = (page: Page, testid: string) =>
	page.getByTestId(testid).evaluate((el) => {
		const range = document.createRange();
		range.selectNodeContents(el);
		return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
	});

test('the clock keeps its room beside long countdowns @J0.4', async ({ page }) => {
	await page.clock.setFixedTime(new Date(`${today}T12:47:00`));
	await page.route('**/api/countdowns', (route) =>
		route.fulfill({
			json: [
				{ id: 'a', title: 'The big city trip is happening', targetDate: today, icon: null },
				{
					id: 'b',
					title: 'Best friend birthday bash and sleepover party',
					targetDate: '2043-03-21',
					icon: null
				}
			]
		})
	);
	for (const size of SIZES) {
		await page.setViewportSize(size);
		await gotoHydrated(page, '/');
		const at = `${size.width}x${size.height}`;
		await expect(page.getByTestId('home-countdown')).toHaveCount(2);
		const time = (await page.getByTestId('clock-time').boundingBox())!;
		const date = (await page.getByTestId('clock-date').boundingBox())!;
		const main = (await page.locator('main').boundingBox())!;
		expect(time.x, `time not clipped at ${at}`).toBeGreaterThanOrEqual(main.x);
		expect(await lines(page, 'clock-date'), `date on one line at ${at}`).toBe(1);
		for (const pill of await page.getByTestId('home-countdown').all()) {
			const box = (await pill.boundingBox())!;
			expect(overlaps(box, time), `pill clear of the time at ${at}`).toBe(false);
			expect(overlaps(box, date), `pill clear of the date at ${at}`).toBe(false);
			expect(box.x + box.width, `pill inside the page at ${at}`).toBeLessThanOrEqual(
				main.x + main.width + 1
			);
		}
	}
});
