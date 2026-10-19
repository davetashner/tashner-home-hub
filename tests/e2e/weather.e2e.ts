import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

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

test('the home widget shows temperature, condition and forecast @J0.2', async ({ page }) => {
	await mockWeather(page, snapshot(NOW));
	await gotoHydrated(page, '/');
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

test('stale data carries an out-of-date note @J0.2', async ({ page }) => {
	await mockWeather(page, snapshot(NOW - 4 * 60 * 60 * 1000));
	await gotoHydrated(page, '/');
	await expect(page.getByText('Weather may be out of date.')).toBeVisible();
});

test('with no location the widget is absent and home still renders @J0.2', async ({ page }) => {
	await mockWeather(page, { enabled: false });
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('weather-widget')).toHaveCount(0);
	await expect(page.locator('main')).toBeVisible();
});

test('the widget does not overflow at phone and tablet sizes @J0.2', async ({ page }) => {
	await mockWeather(page, snapshot(NOW));
	for (const [width, height] of [
		[390, 844],
		[844, 390],
		[820, 1180],
		[1180, 820]
	]) {
		await page.setViewportSize({ width, height });
		await gotoHydrated(page, '/');
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

test('grown-ups search, pick, save and remove a weather location @J9.7 @J0.2', async ({
	page
}, info) => {
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
		await gotoHydrated(page, '/settings/weather');
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

test('a late location load does not undo the place the adult just saved @J9.7', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-weather-late-${info.project.name}`);
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	let held = 0;
	// Both calls are answered here so the shared server's real weather setting is never touched.
	await page.route('**/api/settings/weather', async (route) => {
		if (route.request().method() === 'GET') {
			held++;
			await gate;
			return route.fulfill({ json: { location: null } });
		}
		const body = route.request().postDataJSON() as { name: string; unit: string };
		return route.fulfill({
			json: { location: { name: body.name, lat: 1, lon: 2, unit: body.unit } }
		});
	});
	await gotoHydrated(page, '/settings/weather');
	await expect.poll(() => held).toBeGreaterThan(0);
	await page.getByRole('searchbox', { name: 'City or postal code' }).fill('Placeville');
	await page.getByLabel('Latitude').fill('1');
	await page.getByLabel('Longitude').fill('2');
	await page.getByRole('button', { name: 'Use coordinates' }).click();
	await expect(page.getByTestId('weather-current')).toHaveText('Placeville');
	release();
	await page.waitForTimeout(300);
	await expect(page.getByTestId('weather-current')).toHaveText('Placeville');
});
