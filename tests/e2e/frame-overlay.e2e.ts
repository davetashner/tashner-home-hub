import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';
import { syntheticJpeg } from '../../src/lib/server/photo-cache/fixtures';

// Page routes must see every request; a service worker would answer some from the real server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);
test.beforeEach(({ context }) => asWallDisplay(context));

const ALL_ON = { clock: true, date: true, weather: true, nextEvent: true };

/**
 * Serves this page its own photo, weather, events and overlay settings, so the shared test
 * server's data never leaks in and the real settings are never touched. PUTs update the stub.
 */
async function stubFrame(page: Page, id: string) {
	const jpeg = await syntheticJpeg(640, 360);
	const settings: Record<string, boolean> = { ...ALL_ON };
	const saved: unknown[] = [];
	await page.route(/\/api\/photo\/[^/?]+\?/, (route) => {
		if (new URL(route.request().url()).searchParams.get('part') === 'bg')
			return route.fulfill({ status: 404 });
		return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
	});
	await page.route('**/api/photo/slideshow?**', (route) =>
		route.fulfill({ json: [{ id, w: 640, h: 360 }] })
	);
	await page.route('**/api/settings/slideshow', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { intervalSeconds: 600, transition: 'fade' } })
			: route.fallback()
	);
	await page.route('**/api/settings/idle', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { homeMinutes: 0, frameMinutes: 1 } })
			: route.fallback()
	);
	await page.route('**/api/settings/frame-overlay', (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: settings });
		const patch = route.request().postDataJSON() as Record<string, boolean>;
		saved.push(patch);
		Object.assign(settings, patch);
		return route.fulfill({ json: settings });
	});
	await page.route('**/api/weather', (route) =>
		route.fulfill({
			json: {
				enabled: true,
				location: { name: 'Testville', unit: 'F' },
				snapshot: {
					unit: 'F',
					fetchedAt: Date.now(),
					current: { temp: 72, feelsLike: 70, wind: 4, code: 0, isDay: true },
					// Yesterday to two days out, so both "Today" and "Tomorrow" exist in any zone.
					days: [-1, 0, 1, 2].map((n) => ({
						date: new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10),
						code: 63,
						high: 80,
						low: 60,
						precip: 70
					}))
				}
			}
		})
	);
	await page.route('**/api/calendar/events?**', (route) => {
		const start = Date.now() + 2 * 3_600_000;
		return route.fulfill({
			json: [
				{
					id: 'e2e-swim',
					sourceId: 's',
					title: 'Swim practice',
					startsAt: start,
					endsAt: start + 3_600_000,
					allDay: false,
					recurrence: null,
					location: null,
					notes: null,
					members: []
				}
			]
		});
	});
	return saved;
}

test('the idle frame shows clock, date, weather and next event; a touch still exits', async ({
	page
}, info) => {
	await stubFrame(page, `${info.project.name}-overlay`);
	await page.clock.install();
	await page.goto('/lists');
	await page.waitForLoadState('networkidle');
	await page.clock.fastForward(60_000);
	await expect(page).toHaveURL(/\/photos$/);

	await expect(page.getByTestId('overlay-time')).toHaveText(/^\d{1,2}:\d{2} [AP]M$/);
	await expect(page.getByTestId('overlay-date')).toBeVisible();
	await expect(page.getByTestId('overlay-weather-now')).toHaveText(/^\s*72°\s*Current\s*$/);
	await expect(page.getByTestId('overlay-weather-day')).toHaveText(
		/^\s*(Today|Tomorrow)\s*80°\s*\/\s*60°\s*$/
	);
	await expect(page.getByTestId('overlay-next')).toContainText('Next: Swim practice · ');

	// The overlay is only a picture: a tap on it wakes the screen like anywhere else.
	const nav = page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Calendar' });
	await expect(async () => {
		const box = (await nav.boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page).toHaveURL(/\/lists$/, { timeout: 1_000 });
	}).toPass();
});

test('a grown-up turns an overlay off and the frame leaves it out', async ({ page }, info) => {
	const saved = await stubFrame(page, `${info.project.name}-toggle`);
	await signInAsAdult(page, `e2e-overlay-adult-${info.project.name}`);
	await page.goto('/settings/screen');

	const weather = page.getByRole('button', { name: 'Weather', exact: true });
	await expect(weather).toHaveAttribute('aria-pressed', 'true');
	for (const name of ['Clock', 'Date', 'Weather', 'Next event'])
		await expectTappable(page.getByRole('button', { name, exact: true }));
	await weather.click();
	await expect(weather).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => saved).toEqual([{ weather: false }]);

	await page.goto('/photos');
	await expect(page.getByTestId('overlay-time')).toBeVisible();
	await expect(page.getByTestId('overlay-next')).toBeVisible();
	await expect(page.getByTestId('overlay-weather')).toHaveCount(0);
});
