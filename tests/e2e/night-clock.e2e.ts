import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { asWallDisplay } from './display';
import { gotoHydrated } from './hydrated';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);
test.beforeEach(({ context }) => asWallDisplay(context));

// 2:07 AM UTC on a Tuesday; the household zone only shifts the displayed hour.
const FROZEN = new Date('2026-10-20T02:07:00Z');

async function power(page: Page, mode: string, until?: string) {
	const wakes: string[] = [];
	await page.route('**/api/display/power', (route) =>
		route.fulfill({
			json: { power: mode === 'off' ? 'off' : 'on', reason: 'schedule', mode, until }
		})
	);
	await page.route('**/api/display/wake', (route) => {
		wakes.push(route.request().method());
		return route.fulfill({ json: { power: 'on', reason: 'wake' } });
	});
	return wakes;
}

test('the night clock is a dim, warm, large clock; a touch wakes the app', async ({ page }) => {
	const wakes = await power(page, 'night-clock');
	await page.clock.install({ time: FROZEN });
	await gotoHydrated(page, '/');
	const overlay = page.getByTestId('night-clock');
	await expect(overlay).toBeVisible();
	await expect(page.getByTestId('night-clock-time')).toHaveText(/^\d{1,2}:07\s?(AM|PM)$/);

	// Low light: dark enough and warm (red above blue), never white or blue.
	const [r, , b] = await page.getByTestId('night-clock-time').evaluate((el) => {
		// Computed colors are oklch(); a canvas pixel gives plain sRGB channels.
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.fillStyle = getComputedStyle(el).color;
		ctx.fillRect(0, 0, 1, 1);
		return [...ctx.getImageData(0, 0, 1, 1).data];
	});
	expect(r).toBeGreaterThan(b);
	expect(r).toBeLessThan(140);

	// It fills the screen in this orientation without leaving it.
	const view = page.viewportSize()!;
	const box = (await page.getByTestId('night-clock-time').boundingBox())!;
	expect(box.width).toBeGreaterThan(view.width * 0.45);
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(view.width);

	// The clock drifts a little each minute (burn-in), and a touch wakes the app.
	await page.clock.fastForward(60_000);
	await expect(page.getByTestId('night-clock-time')).toHaveText(/:08\s?(AM|PM)$/);
	await overlay.click();
	await expect(overlay).toBeHidden();
	expect(wakes).toEqual(['POST']);
});

test('the night clock names the morning first event, dim and warm', async ({ page }) => {
	// Wake 06:30 UTC on the frozen night; the household zone can shift the displayed hour, so the
	// event time is asserted loosely and the title and "Today" wording exactly.
	const wake = Date.parse('2026-10-20T06:30:00Z');
	const asked: string[] = [];
	await power(page, 'night-clock', new Date(wake).toISOString());
	await page.route('**/api/calendar/events**', (route) => {
		asked.push(route.request().url());
		return route.fulfill({
			json: [
				{
					title: 'Before waking',
					startsAt: wake - 3_600_000,
					endsAt: wake - 1_800_000,
					allDay: false
				},
				{
					title: 'Swim practice',
					startsAt: wake + 45 * 60_000,
					endsAt: wake + 3_600_000,
					allDay: false
				},
				{
					title: 'Dentist',
					startsAt: wake + 5 * 3_600_000,
					endsAt: wake + 6 * 3_600_000,
					allDay: false
				}
			]
		});
	});
	await page.clock.install({ time: FROZEN });
	await gotoHydrated(page, '/');
	const line = page.getByTestId('night-clock-event');
	await expect(line).toHaveText(/^(Today|Tomorrow) \d{1,2}:\d{2}\s?(AM|PM) · Swim practice$/);
	expect(asked.length).toBeGreaterThan(0);

	const [r, , b] = await line.evaluate((el) => {
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.fillStyle = getComputedStyle(el).color;
		ctx.fillRect(0, 0, 1, 1);
		return [...ctx.getImageData(0, 0, 1, 1).data];
	});
	expect(r).toBeGreaterThan(b);
	expect(r).toBeLessThan(140);

	// Smaller than the clock, and inside the screen in this orientation.
	const view = page.viewportSize()!;
	const lineBox = (await line.boundingBox())!;
	const timeBox = (await page.getByTestId('night-clock-time').boundingBox())!;
	expect(lineBox.height).toBeLessThan(timeBox.height);
	expect(lineBox.x).toBeGreaterThanOrEqual(0);
	expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(view.width);
});

test('with no event the night clock shows no event line', async ({ page }) => {
	await power(page, 'night-clock', new Date('2026-10-20T06:30:00Z').toISOString());
	await page.route('**/api/calendar/events**', (route) => route.fulfill({ json: [] }));
	await page.clock.install({ time: FROZEN });
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('night-clock-time')).toBeVisible();
	await expect(page.getByTestId('night-clock-event')).toHaveCount(0);
});

test('normal and off modes show no night clock', async ({ page }) => {
	for (const mode of ['normal', 'off']) {
		await power(page, mode);
		await gotoHydrated(page, '/');
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
		await expect(page.getByTestId('night-clock')).toHaveCount(0);
		// Leave the page first so no power poll is in flight, then let running handlers finish:
		// otherwise the request falls through to asWallDisplay's context route mid-fulfil.
		await page.goto('about:blank');
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('a personal device never shows the night clock', async ({ page, context }) => {
	await context.clearCookies();
	await power(page, 'night-clock');
	await gotoHydrated(page, '/');
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	await expect(page.getByTestId('night-clock')).toHaveCount(0);
});

test('grown-ups turn the night clock on and off', async ({ page }, info) => {
	// The setting is shared by every test on this server, so the API is answered here.
	const saved: unknown[] = [];
	await page.route('**/api/settings/night-clock', (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: false } });
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: route.request().postDataJSON() });
	});
	await signInAsAdult(page, `e2e-night-clock-${info.project.name}`);
	await gotoHydrated(page, '/settings/sleep-schedule');
	const summary = page.getByTestId('night-clock-summary');
	await expect(summary).toContainText('turns fully off');
	await page.getByRole('button', { name: 'Night clock On' }).click();
	await expect(summary).toContainText('very dim clock');
	await expect.poll(() => saved).toContainEqual({ enabled: true });
});
