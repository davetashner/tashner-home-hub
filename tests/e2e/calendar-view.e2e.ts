import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { expectTappable } from './tap';

test.beforeEach(async ({ page }) => {
	seedCalendar({ fresh: false });
	await signInAsAdult(page, 'e2e-cal-adult');
	await page.goto('/calendar');
	await page.waitForLoadState('networkidle');
});

test('agenda shows today, members, location, and opens a details sheet', async ({ page }) => {
	const pane = page.getByTestId('calendar-pane');
	for (const title of ['Soccer practice', 'Dentist', 'Grandma visits', 'School holiday']) {
		await expect(pane.getByText(title).first()).toBeVisible();
	}
	await expect(pane.getByText('Maple Park')).toBeVisible();
	await pane.getByRole('button', { name: /Soccer practice/ }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('heading', { name: 'Soccer practice' })).toBeVisible();
	await expect(sheet.getByText('Avery')).toBeVisible();
	await expect(sheet.getByText('Bring water.')).toBeVisible();
	await expectTappable(sheet.getByRole('button', { name: 'Close', exact: true }));
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test('shows the stale badge without blocking the view', async ({ page }) => {
	await expect(page.getByTestId('stale-badge')).toContainText(/Last updated 4\d min ago/);
	await expect(page.getByTestId('calendar-pane').getByText('Dentist').first()).toBeVisible();
});

test('calendar controls meet the 60px minimum', async ({ page }) => {
	for (const name of ['Previous', 'Today', 'Next']) {
		await expectTappable(page.getByRole('button', { name, exact: true }));
	}
});
