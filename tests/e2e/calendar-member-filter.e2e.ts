import { expect, test } from '@playwright/test';
import { seedCalendar } from './calendar.js';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

// FAM-4: member chips narrow Agenda, Week and Month, and the choice survives a reload.
test('member chips filter the calendar and are remembered @J5.3', async ({ page }) => {
	seedCalendar();
	await gotoHydrated(page, '/calendar');
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
	await chip('Avery').click();
	await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'true');
	await expect(pane.getByText('Soccer practice').first()).toBeVisible();
	await expect(pane.getByText('Dentist')).toHaveCount(0);
	await expect(pane.getByText('Grandma visits')).toHaveCount(0);
	// Family-wide events (no member) stay visible while filtering.
	await expect(pane.getByText('School holiday').first()).toBeVisible();

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

	await reloadHydrated(page);
	await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'true');
	await expect(chip('Blake')).toHaveAttribute('aria-pressed', 'true');
	await expect(pane.getByText('Grandma visits')).toHaveCount(0);

	await chip('Everyone').click();
	await expect(chip('Everyone')).toHaveAttribute('aria-pressed', 'true');
	await expect(chip('Avery')).toHaveAttribute('aria-pressed', 'false');
	await expect(pane.getByText('Grandma visits').first()).toBeVisible();
});

test('member chips stay inside a phone-width screen @J5.3', async ({ page }) => {
	seedCalendar();
	await page.setViewportSize({ width: 393, height: 659 });
	await gotoHydrated(page, '/calendar');
	await expect(page.getByTestId('member-filter')).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test("a member chip's avatar sits in the pill's rounded left end @J5.3", async ({ page }) => {
	seedCalendar({ fresh: false });
	await gotoHydrated(page, '/calendar');
	const chip = page
		.getByTestId('member-filter')
		.getByRole('button', { name: 'Avery', exact: true });
	// Retried: the page's entrance animation moves the chips for a moment after load.
	await expect(async () => {
		const c = (await chip.boundingBox())!;
		const a = (await chip.locator('.chip-avatar').boundingBox())!;
		// Flush left: only the 2px border between the pill's edge and the avatar, as at top and bottom.
		expect(a.x - c.x).toBeLessThanOrEqual(3);
		expect(Math.abs(a.y + a.height / 2 - (c.y + c.height / 2))).toBeLessThanOrEqual(1);
	}).toPass();
});
