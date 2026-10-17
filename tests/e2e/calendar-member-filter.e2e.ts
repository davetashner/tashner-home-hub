import { expect, test } from '@playwright/test';
import { seedCalendar } from './calendar.js';
import { expectTappable } from './tap';

// FAM-4: member chips narrow Agenda, Week and Month, and the choice survives a reload.
test('member chips filter the calendar and are remembered', async ({ page }) => {
	seedCalendar();
	await page.goto('/calendar');
	const filter = page.getByTestId('member-filter');
	const pane = page.getByTestId('calendar-pane');
	const view = page.getByRole('group', { name: 'View' });
	const chip = (name: string) => filter.getByRole('button', { name, exact: true });

	await expect(pane.getByText('Soccer practice').first()).toBeVisible();
	await expectTappable(chip('Everyone'));
	await expectTappable(chip('Avery'));

	for (const mode of ['Agenda', 'Week', 'Month']) {
		await view.getByRole('button', { name: mode }).click();
		await expect(pane.getByText('Dentist').first()).toBeVisible();
	}

	await view.getByRole('button', { name: 'Agenda' }).click();
	// The first tap can land before hydration on WebKit, so retry until it takes.
	await expect(async () => {
		await chip('Avery').click();
		await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
	}).toPass();
	await expect(pane.getByText('Soccer practice').first()).toBeVisible();
	await expect(pane.getByText('Dentist')).toHaveCount(0);
	await expect(pane.getByText('Grandma visits')).toHaveCount(0);

	// A second member adds their events; the shared Dentist shows for either of its members.
	await chip('Blake').click();
	await expect(pane.getByText('Dentist').first()).toBeVisible();
	await expect(pane.getByText('Soccer practice').first()).toBeVisible();
	await expect(pane.getByText('Grandma visits')).toHaveCount(0);

	for (const mode of ['Week', 'Month']) {
		await view.getByRole('button', { name: mode }).click();
		await expect(pane.getByText('Dentist').first()).toBeVisible();
		await expect(pane.getByText('Grandma visits')).toHaveCount(0);
	}

	await page.reload();
	await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'true');
	await expect(chip('Blake')).toHaveAttribute('aria-pressed', 'true');
	await expect(pane.getByText('Grandma visits')).toHaveCount(0);

	await chip('Everyone').click();
	await expect(chip('Everyone')).toHaveAttribute('aria-pressed', 'true');
	await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'false');
	await expect(pane.getByText('Grandma visits').first()).toBeVisible();
});

test('member chips stay inside a phone-width screen', async ({ page }) => {
	seedCalendar();
	await page.setViewportSize({ width: 393, height: 659 });
	await page.goto('/calendar');
	await expect(page.getByTestId('member-filter')).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
