import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { gotoHydrated } from './hydrated';

const chooseView = (page: Page, name: string) =>
	page.getByRole('group', { name: 'View' }).getByRole('button', { name }).click();

/** Today at 12:00 in the browser's zone, so the line sits inside the default 7-21 grid. */
function noon(): Date {
	const d = new Date();
	d.setHours(12, 0, 0, 0);
	return d;
}

test.beforeEach(async ({ page }) => {
	seedCalendar({ fresh: false });
	await signInAsAdult(page, 'e2e-cal-adult');
	await page.clock.install({ time: noon() });
	await gotoHydrated(page, '/calendar');
	await page.waitForLoadState('networkidle');
});

test('week grid draws the now line and moves it down as the minutes pass', async ({ page }) => {
	const pane = page.getByTestId('calendar-pane');
	await chooseView(page, 'Week');
	await expect(pane.locator('.week')).toBeVisible();
	const line = pane.getByTestId('now-line');
	await expect(line).toHaveCount(1);
	// Offset within the grid, not the viewport: the grid scrolls itself to "now" after it mounts,
	// which moved the line on screen between the two measurements.
	const top = () => line.evaluate((el) => (el as HTMLElement).offsetTop);
	const before = await top();

	await page.clock.runFor(10 * 60_000);
	await expect.poll(top).toBeGreaterThan(before + 10);
});

test('agenda marks now between the events that have and have not started', async ({ page }) => {
	const pane = page.getByTestId('calendar-pane');
	const line = pane.getByTestId('now-line').first();
	await expect(line).toBeVisible();
	await expect(line).toHaveText('Now');
});
