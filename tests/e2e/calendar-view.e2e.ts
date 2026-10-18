import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

async function swipe(page: Page, from: number, to: number) {
	const box = (await page.getByTestId('calendar-pane').boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * from, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
	await page.mouse.up();
}

const chooseView = (page: Page, name: string) =>
	page.getByRole('group', { name: 'View' }).getByRole('button', { name }).click();

test.beforeEach(async ({ page }) => {
	seedCalendar({ fresh: false });
	await signInAsAdult(page, 'e2e-cal-adult');
	await gotoHydrated(page, '/calendar');
	await page.waitForLoadState('networkidle');
});

test('agenda shows today, members, location, and opens a details sheet @J5.1', async ({ page }) => {
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

test('week view shows timed and spanning events, and swipe changes the period @J5.2', async ({
	page
}) => {
	await chooseView(page, 'Week');
	const pane = page.getByTestId('calendar-pane');
	await expect(pane.getByText('Soccer practice')).toBeVisible();
	await expect(pane.getByText('Dentist')).toBeVisible();
	await expect(pane.getByRole('button', { name: /Grandma visits/ })).toBeVisible();
	const before = await page.getByTestId('period-title').innerText();
	await swipe(page, 0.8, 0.2);
	await expect(page.getByTestId('period-title')).not.toHaveText(before);
	await swipe(page, 0.2, 0.8);
	await expect(page.getByTestId('period-title')).toHaveText(before);
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Today' }).click();
	await expect(page.getByTestId('period-title')).toHaveText(before);
});

test('week view blocks and bars are tappable, unclipped, and open near now @J5.2', async ({
	page
}) => {
	await chooseView(page, 'Week');
	const pane = page.getByTestId('calendar-pane');
	await expect(pane.locator('.bar').first()).toBeVisible();
	for (const bar of await pane.locator('.bar').all()) await expectTappable(bar);

	// Scroll through the grid so every block is checked, not only those on screen.
	const blocks = pane.locator('.block-ev');
	expect(await blocks.count()).toBeGreaterThanOrEqual(2);
	for (const block of await blocks.all()) {
		await block.scrollIntoViewIfNeeded();
		await expectTappable(block);
		const title = block.locator('.title');
		const clipped = await title.evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(clipped, 'title should not overflow sideways').toBe(false);
	}
	for (const bar of await pane.locator('.bar').all()) {
		const clipped = await bar.locator('span').evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(clipped).toBe(false);
	}

	// Reopen at 20:45 (page zone), late enough that the line used to fall below the pane: the
	// grid should land on the current time.
	const pinned = await page.evaluate(() => {
		const d = new Date();
		d.setHours(20, 45, 0, 0);
		return d.getTime();
	});
	await page.clock.install({ time: pinned });
	await reloadHydrated(page);
	await page.waitForLoadState('networkidle');
	await expect(pane.locator('.now')).toBeVisible();
	await expect
		.poll(async () => {
			const box = (await pane.boundingBox())!;
			const line = (await pane.locator('.now').boundingBox())!;
			return line.y >= box.y && line.y <= box.y + box.height;
		})
		.toBe(true);
});

test('tapping empty space in a week column opens that day in the agenda @J5.2', async ({
	page
}) => {
	await chooseView(page, 'Week');
	const pane = page.getByTestId('calendar-pane');
	const hit = pane.locator('.day-hit').nth(3);
	// The grid auto-scrolls, so the column's top may sit under the sticky header: click its handler directly.
	await hit.dispatchEvent('click');
	await expect(
		page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Agenda' })
	).toHaveAttribute('aria-pressed', 'true');
});

test('month view lists events and a day tap opens that day in the agenda @J5.2', async ({
	page
}) => {
	await chooseView(page, 'Month');
	const pane = page.getByTestId('calendar-pane');
	await expect(pane.getByText('Grandma visits').first()).toBeVisible();
	const cell = pane.getByRole('button', { name: /3 events|4 events/ }).first();
	await expectTappable(cell);
	await cell.click();
	await expect(
		page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Agenda' })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('calendar-pane').getByText('Dentist')).toBeVisible();
});

test('remembers the last view and shows the stale badge without blocking @J5.7', async ({
	page
}) => {
	await chooseView(page, 'Week');
	await reloadHydrated(page);
	await expect(page.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('stale-badge')).toContainText(/Last updated 4\d min ago/);
	await expect(page.getByTestId('calendar-pane').getByText('Dentist')).toBeVisible();
});

test('calendar controls meet the 60px minimum @J16.1', async ({ page }) => {
	for (const name of ['Agenda', 'Week', 'Month', 'Previous', 'Today', 'Next']) {
		await expectTappable(page.getByRole('button', { name, exact: true }));
	}
});
