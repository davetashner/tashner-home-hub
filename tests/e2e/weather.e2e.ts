import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const NOW = Date.now();
const days = ['2030-01-01', '2030-01-02', '2030-01-03', '2030-01-04', '2030-01-05'].map(
	(date, i) => ({ date, code: i === 1 ? 96 : 63, high: 70 + i, low: 50 + i, precip: 40 })
);
const snapshot = (fetchedAt: number) => ({
	enabled: true,
	location: { name: 'Testville' },
	snapshot: {
		unit: 'F',
		current: { temp: 68, feelsLike: 66, wind: 7, code: 2, isDay: true },
		days,
		fetchedAt
	}
});

async function mockWeather(page: Page, body: unknown) {
	await page.route('**/api/weather', (route) => route.fulfill({ json: body }));
}

test('the home widget shows temperature, condition and forecast', async ({ page }) => {
	await mockWeather(page, snapshot(NOW));
	await page.goto('/');
	const widget = page.getByTestId('weather-widget');
	await expect(widget).toBeVisible();
	await expect(page.getByTestId('weather-temp')).toHaveText('68°F');
	await expect(widget.getByText('Partly cloudy')).toBeVisible();
	// condition labels are visible text, not hover-only titles
	await expect(
		widget.getByRole('list', { name: 'Forecast' }).getByText('Rain').first()
	).toBeVisible();
	await expect(widget.getByText('Weather may be out of date.')).toHaveCount(0);
});

test('stale data carries an out-of-date note', async ({ page }) => {
	await mockWeather(page, snapshot(NOW - 4 * 60 * 60 * 1000));
	await page.goto('/');
	await expect(page.getByText('Weather may be out of date.')).toBeVisible();
});

test('with no location the widget is absent and home still renders', async ({ page }) => {
	await mockWeather(page, { enabled: false });
	await page.goto('/');
	await expect(page.getByTestId('weather-widget')).toHaveCount(0);
	await expect(page.locator('main')).toBeVisible();
});

test('the widget does not overflow at phone and tablet sizes', async ({ page }) => {
	await mockWeather(page, snapshot(NOW));
	for (const [width, height] of [
		[390, 844],
		[844, 390],
		[820, 1180],
		[1180, 820]
	]) {
		await page.setViewportSize({ width, height });
		await page.goto('/');
		const widget = page.getByTestId('weather-widget');
		await expect(widget).toBeVisible();
		const over = await page.evaluate(() => {
			const w = document.querySelector('[data-testid="weather-widget"]') as HTMLElement;
			return {
				page: document.documentElement.scrollWidth - window.innerWidth,
				widget: w.scrollWidth - w.clientWidth
			};
		});
		expect(over, `${width}x${height}`).toEqual({ page: expect.any(Number), widget: 0 });
		expect(over.page, `${width}x${height}`).toBeLessThanOrEqual(0);
	}
});

test('grown-ups search, pick, save and remove a weather location', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-weather-${info.project.name}`);
	await page.route('**/api/settings/weather/search*', (route) =>
		route.fulfill({
			json: { results: [{ name: 'Springfield, Illinois', lat: 39.8, lon: -89.65 }] }
		})
	);
	try {
		// the page's mount fetch marks hydration: a tap before it would submit the form natively
		const mounted = page.waitForResponse(
			(r) => r.request().method() === 'GET' && r.url().endsWith('/api/settings/weather')
		);
		await page.goto('/settings/weather');
		await mounted;
		await expect(async () => {
			await page.getByRole('searchbox', { name: 'City or postal code' }).fill('Springfield');
			await expectTappable(page.getByRole('button', { name: 'Search' }));
			await page.getByRole('button', { name: 'Search' }).click();
			await expect(page.getByRole('button', { name: 'Springfield, Illinois' })).toBeVisible({
				timeout: 1500
			});
		}).toPass();
		const pick = page.getByRole('button', { name: 'Springfield, Illinois' });
		await expectTappable(pick);
		await pick.click();
		await expect(page.getByTestId('weather-current')).toHaveText('Springfield, Illinois');
		await expectTappable(page.getByRole('button', { name: '°F' }));
		await expectTappable(page.getByRole('button', { name: '°C' }));
		await expectTappable(page.getByRole('button', { name: 'Use coordinates' }));

		// real DELETE against the server (no mock): proves the CSRF-safe body works
		const off = page.getByRole('button', { name: 'Turn off weather' });
		await expectTappable(off);
		const deleted = page.waitForResponse(
			(r) => r.request().method() === 'DELETE' && r.url().endsWith('/api/settings/weather')
		);
		await off.click();
		expect((await deleted).status()).toBe(200);
		await expect(page.getByTestId('weather-current')).toHaveCount(0);
		await expect(page.getByText('Weather is off.')).toBeVisible();
	} finally {
		await page.request.delete('/api/settings/weather', {
			headers: { 'content-type': 'application/json' },
			data: '{}'
		});
	}
});
