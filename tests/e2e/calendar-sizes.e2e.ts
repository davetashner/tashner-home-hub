import { expect, test, type Page } from '@playwright/test';
import { seedCalendar } from './calendar.js';

// Phone and iPad sizes (requirements §3.10, DEV-4): the calendar must fit with no sideways scroll.
// iPhone landscape (852x393) is left out until the shell stops filling that screen (hub-0hv.8).
const SIZES = [
	{ name: 'iphone-portrait', width: 393, height: 659 },
	{ name: 'ipad-portrait', width: 834, height: 1194 },
	{ name: 'ipad-landscape', width: 1194, height: 834 }
];

async function expectFits(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	const width = await page.evaluate(() => window.innerWidth);
	const view = page.getByRole('group', { name: 'View' });
	for (const name of ['Agenda', 'Week', 'Month']) {
		const box = await view.getByRole('button', { name }).boundingBox();
		expect(box, name).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);
		expect(box!.height).toBeGreaterThanOrEqual(60);
	}
	const title = await page.getByTestId('period-title').boundingBox();
	expect(title!.x + title!.width).toBeLessThanOrEqual(width);
}

async function expectTitleWidth(page: Page, text: string | RegExp) {
	const target = page.getByTestId('calendar-pane').getByText(text).first();
	await expect(target).toBeVisible();
	const w = await target.evaluate((el) => el.getBoundingClientRect().width);
	expect(w).toBeGreaterThan(40);
}

for (const size of SIZES) {
	test(`calendar fits at ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
		seedCalendar();
		await page.setViewportSize({ width: size.width, height: size.height });
		await page.goto('/calendar');
		await page.waitForLoadState('networkidle');
		const view = page.getByRole('group', { name: 'View' });
		const shot = async (v: string) => {
			if (process.env.CAL_SHOTS)
				await page.screenshot({ path: `${process.env.CAL_SHOTS}/${size.name}-${v}.png` });
		};

		await view.getByRole('button', { name: 'Agenda' }).click();
		await page.waitForTimeout(400);
		await shot('agenda');
		await expectFits(page);
		await expectTitleWidth(page, 'Soccer practice');
		await expectTitleWidth(page, 'Dentist');
		await expectTitleWidth(page, 'Grandma visits');

		await view.getByRole('button', { name: 'Week' }).click();
		await page.waitForTimeout(400);
		await shot('week');
		await expectFits(page);
		await expectTitleWidth(page, 'Soccer practice');
		await expectTitleWidth(page, 'Dentist');

		await view.getByRole('button', { name: 'Month' }).click();
		await page.waitForTimeout(400);
		await shot('month');
		await expectFits(page);
		await expectTitleWidth(page, 'Grandma visits');
	});
}
