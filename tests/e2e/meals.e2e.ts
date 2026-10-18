import { expect, test } from '@playwright/test';
import { ensureHousehold } from './adult';
import { seedCalendar } from './calendar';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

// MEAL-1. Each project plans a different far-future week so parallel projects sharing one database
// never see each other's dinner. Mondays: 2043-06-01 is a Monday; offset by project.
const PROJECTS = [
	'wall-landscape-1440p',
	'wall-portrait-1440p',
	'iphone-webkit',
	'ipad-portrait-webkit',
	'ipad-landscape-webkit'
];
const JSON_HEADERS = { 'content-type': 'application/json' };

test('plan a dinner, see it in Meals and the calendar week, edit it, delete it @J7.1 @J7.2', async ({
	page
}, info) => {
	ensureHousehold();
	seedCalendar(); // the calendar page is an empty state until a source exists
	const k = Math.max(0, PROJECTS.indexOf(info.project.name));
	const monday = new Date(Date.UTC(2043, 5, 1 + 7 * k)).toISOString().slice(0, 10);
	const tuesday = new Date(Date.UTC(2043, 5, 2 + 7 * k)).toISOString().slice(0, 10);
	await page.clock.setFixedTime(new Date(`${tuesday}T12:00:00`));
	const tag = `${info.project.name}-${Date.now().toString(36)}`;
	const dinner = `Tacos ${tag}`;
	const edited = `Pasta ${tag}`;

	try {
		const put = await page.request.put('/api/meals', {
			headers: JSON_HEADERS,
			data: { date: tuesday, meal: 'dinner', title: dinner }
		});
		expect(put.ok()).toBe(true);

		await gotoHydrated(page, '/meals');
		const day = page.locator(`[data-testid="meals-day"][data-date="${tuesday}"]`);
		await expect(day).toContainText(dinner);

		// The calendar's week view shows it under the date (when the pane is wide enough for the grid).
		await page.addInitScript(() => localStorage.setItem('hub.calendar.view', 'week'));
		await gotoHydrated(page, '/calendar');
		const pane = page.getByTestId('calendar-pane');
		await expect(pane).toBeVisible();
		if ((await pane.boundingBox())!.width >= 720) {
			await expect(page.getByTestId('week-meal').filter({ hasText: dinner })).toBeVisible();
		}
		await gotoHydrated(page, '/meals');

		// Edit through the sheet.
		await day.locator('[data-slot="dinner"]').click();
		await expect(page.getByTestId('meal-input')).toBeVisible();
		await page.getByTestId('meal-input').fill(edited);
		await page.getByTestId('meal-save').click();
		await expect(day).toContainText(edited);
		await expect(day).not.toContainText(dinner);
		const got = await page.request.get(`/api/meals?week=${monday}`);
		expect(await got.json()).toContainEqual({ date: tuesday, meal: 'dinner', title: edited });

		await expect(day).toHaveClass(/today/);

		// No sideways scroll (390px phone and every other viewport).
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	} finally {
		const del = await page.request.delete('/api/meals', {
			headers: JSON_HEADERS,
			data: { date: tuesday, meal: 'dinner' }
		});
		expect([200, 404]).toContain(del.status());
	}
});

test('meals fits a 390px phone with no sideways scroll @J7.5', async ({ page }) => {
	ensureHousehold();
	await page.setViewportSize({ width: 390, height: 844 });
	await gotoHydrated(page, '/meals');
	await expect(page.getByTestId('meals-day')).toHaveCount(7);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	// Retried: the week re-renders once its meals load, so the first cell can be swapped out
	// between finding it and measuring it (boundingBox is then null).
	await expect(async () => {
		const box = await page.getByTestId('meal-cell').first().boundingBox();
		expect(box).not.toBeNull();
		expect(box!.height).toBeGreaterThanOrEqual(60);
	}).toPass();
});

// Slot labels never break mid-word: a laptop wraps the week, the 4K wall keeps all seven across.
for (const { w, h, perRow } of [
	{ w: 1280, h: 800, perRow: 0 },
	{ w: 1440, h: 900, perRow: 0 },
	{ w: 1728, h: 1117, perRow: 0 },
	{ w: 2560, h: 1440, perRow: 7 }
]) {
	test(`meal slot labels fit on one line at ${w}x${h} @J7.5`, async ({ page }) => {
		ensureHousehold();
		await page.setViewportSize({ width: w, height: h });
		await gotoHydrated(page, '/meals');
		await expect(page.getByTestId('meals-day')).toHaveCount(7);
		const layout = await page.evaluate(() => {
			const labels = [
				...document.querySelectorAll('[data-testid="meal-cell"] > :first-child')
			] as HTMLElement[];
			const lineHeight = parseFloat(getComputedStyle(labels[0]).lineHeight);
			const days = [...document.querySelectorAll('[data-testid="meals-day"]')] as HTMLElement[];
			return {
				tallest: Math.max(...labels.map((l) => l.getBoundingClientRect().height)),
				lineHeight,
				perRow: days.filter((d) => d.offsetTop === days[0].offsetTop).length
			};
		});
		expect(layout.tallest).toBeLessThan(layout.lineHeight * 1.5);
		if (perRow) expect(layout.perRow).toBe(perRow);
	});
}

test('wall: plan a meal with the on-screen keyboard, it survives a reload @J7.1', async ({
	page,
	context
}, info) => {
	ensureHousehold();
	await asWallDisplay(context);
	const k = Math.max(0, PROJECTS.indexOf(info.project.name));
	const monday = new Date(Date.UTC(2044, 5, 6 + 7 * k)).toISOString().slice(0, 10);
	await page.clock.setFixedTime(new Date(`${monday}T12:00:00`));
	const word = `soup${Date.now().toString(36)}`.replace(/[^a-z0-9]/g, '');
	try {
		await gotoHydrated(page, '/meals');
		const day = page.locator(`[data-testid="meals-day"][data-date="${monday}"]`);
		await day.locator('[data-slot="lunch"]').click();
		await expect(page.getByTestId('keyboard')).toBeVisible();
		await expect(page.getByTestId('meal-input')).toHaveCount(0);
		await expectTappable(page.getByTestId('key-q'));
		await expectTappable(page.getByTestId('key-enter'));
		for (const ch of word) await page.getByTestId(`key-${ch}`).click();
		await page.getByTestId('key-enter').click();
		await expect(day).toContainText(word, { ignoreCase: true });
		await reloadHydrated(page);
		await expect(day).toContainText(word, { ignoreCase: true });
	} finally {
		await page.request.delete('/api/meals', {
			headers: JSON_HEADERS,
			data: { date: monday, meal: 'lunch' }
		});
	}
});
