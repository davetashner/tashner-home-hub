import { expect, test, type Page } from '@playwright/test';
import { px } from './tap';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

const destinations = [
	['Calendar', 'calendar'],
	['To-Do List', 'chores'],
	['Photos', 'photos'],
	['Lists', 'lists'],
	['Meals', 'meals'],
	['Games', 'games'],
	['Music', 'music']
];

async function swipe(page: Page, from: number, to: number) {
	const box = (await page.locator('main').boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * from, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
	await page.mouse.up();
}

test('every destination is reachable by tap and marks itself active', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const nav = page.getByRole('navigation', { name: 'Main' });
	for (const [name, path] of destinations) {
		await nav.getByRole('link', { name }).click();
		await expect(page).toHaveURL(new RegExp(`/${path}$`));
		await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
		await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	}
});

test('settings gear opens settings', async ({ page }) => {
	await signInAsAdult(page, 'e2e-shell-adult');
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/settings$/);
});

test('shell controls meet the 60px touch minimum', async ({ page }) => {
	await page.goto('/chores');
	const controls = page.locator('header a, header button, nav a');
	const count = await controls.count();
	expect(count).toBeGreaterThanOrEqual(8);
	for (let i = 0; i < count; i++) {
		const box = (await controls.nth(i).boundingBox())!;
		const label =
			(await controls.nth(i).innerText()) || (await controls.nth(i).getAttribute('aria-label'));
		expect(px(box.width), `${label} width`).toBeGreaterThanOrEqual(60);
		expect(px(box.height), `${label} height`).toBeGreaterThanOrEqual(60);
	}
});

test('swiping moves to the adjacent destination', async ({ page }) => {
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	await swipe(page, 0.8, 0.2);
	await expect(page).toHaveURL(/\/photos$/);
	await swipe(page, 0.2, 0.8);
	await expect(page).toHaveURL(/\/chores$/);
});

test('sleep button posts to the display endpoint', async ({ page }) => {
	await page.goto('/calendar');
	await page.waitForLoadState('networkidle');
	const request = page.waitForRequest(
		(r) => r.url().endsWith('/api/display/sleep') && r.method() === 'POST'
	);
	await page.getByRole('button', { name: 'Sleep' }).click();
	const response = await (await request).response();
	expect(response?.status()).toBe(202);
});

test('sleep endpoint answers 202 with the power state', async ({ request }) => {
	const response = await request.post('/api/display/sleep', {
		data: {}
	});
	expect(response.status()).toBe(202);
	expect(await response.json()).toMatchObject({ power: 'off' });
});

test('header clock and date are visible away from home', async ({ page }) => {
	await page.goto('/lists');
	await expect(page.getByTestId('header-clock-time')).toBeVisible();
	await expect(page.getByTestId('header-clock-date')).toBeVisible();
});

test('the header clock keeps the time on one line with a crowded header', async ({
	page
}, info) => {
	// Crowded header: adult session (Lock), a pending approval (badge), two kids (child switcher),
	// and a long date with a two-digit hour.
	await signInAsAdult(page, `adult-clk-${info.project.name.replace(/\W/g, '')}`);
	const stamp = `${Date.now() % 1e9}`;
	const ids: string[] = [];
	for (const [name, color, avatar] of [
		['Pip', 'member-3', '🐸'],
		['Moss', 'member-5', '🦉']
	]) {
		const kid = await (
			await page.request.post('/api/members', {
				data: { name: `${name} ${stamp}`, role: 'child', color, avatar }
			})
		).json();
		ids.push(kid.id);
	}
	const chore = await (
		await page.request.post('/api/chores', {
			data: {
				title: 'Tidy toys',
				icon: '🧸',
				stars: 1,
				memberIds: ids,
				schedule: { type: 'daily' }
			}
		})
	).json();
	await page.request.post(`/api/chores/${chore.id}/complete`, { data: { memberId: ids[0] } });

	await page.clock.setFixedTime(new Date('2026-09-23T10:06:00'));
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('approvals-badge')).toBeVisible();
	if (page.viewportSize()!.width < 640) return; // the phone header hides the clock
	const time = page.getByTestId('header-clock-time');
	await expect(time).toBeVisible();
	const { height, lineHeight } = await time.evaluate((el) => ({
		height: el.getBoundingClientRect().height,
		lineHeight: parseFloat(getComputedStyle(el).lineHeight)
	}));
	expect(height).toBeLessThan(lineHeight * 1.5);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	// Landscape has the width: the clock and the controls share one row instead of stacking.
	const { width, height: viewHeight } = page.viewportSize()!;
	if (width > viewHeight) {
		const clock = (await time.locator('xpath=ancestor::a').boundingBox())!;
		const sleep = (await page.getByRole('button', { name: 'Sleep' }).boundingBox())!;
		expect(sleep.y).toBeGreaterThanOrEqual(clock.y);
		expect(sleep.y).toBeLessThan(clock.y + clock.height);
		// The tappable link hugs the clock text, so it cannot swallow the row and send stray taps home.
		const date = (await page.getByTestId('header-clock-date').boundingBox())!;
		const content = Math.max((await time.boundingBox())!.width, date.width);
		expect(clock.width).toBeLessThanOrEqual(content + 1);
	}
});
