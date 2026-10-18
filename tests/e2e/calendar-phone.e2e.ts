import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { gotoHydrated } from './hydrated';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
	seedCalendar({ fresh: false });
	await signInAsAdult(page, 'e2e-cal-phone-adult');
	await gotoHydrated(page, '/calendar');
	await page.waitForLoadState('networkidle');
});

test('on a phone the whole page scrolls, not a short inner calendar pane', async ({ page }) => {
	for (const view of ['Agenda', 'Week', 'Month']) {
		await page.getByRole('group', { name: 'View' }).getByRole('button', { name: view }).click();
		const pane = page.getByTestId('calendar-pane');
		await expect(pane).toBeVisible();
		// The pane shows all of its content: nothing is hidden behind an inner scroll.
		const clipped = await pane.evaluate((el) => el.scrollHeight - el.clientHeight);
		expect(clipped, `${view}: pane should not scroll on its own`).toBeLessThanOrEqual(1);
	}

	// The member chips are not cut off by a capped, scrolling row.
	const chips = page.getByTestId('member-filter');
	const hidden = await chips.evaluate((el) => el.scrollHeight - el.clientHeight);
	expect(hidden, 'member chips should not be clipped').toBeLessThanOrEqual(1);

	// Scrolling the page moves the controls away and brings the last event on screen.
	await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
	const last = page.getByTestId('calendar-pane').getByRole('button').last();
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport();
});
