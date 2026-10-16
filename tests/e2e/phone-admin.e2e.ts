import { expect, test, type Locator, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { signInAsAdult } from './adult';

// ADM-1: every admin page must be usable from a phone (390x844). Pages are discovered from the
// settings subtree so new ones are covered automatically.
const settingsDir = path.resolve('src/routes/(app)/settings');

function discover(dir = settingsDir, urlPath = '/settings'): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const routes = entries.some((e) => e.isFile() && e.name === '+page.svelte') ? [urlPath] : [];
	for (const e of entries) {
		if (!e.isDirectory() || /^\[.*\]$/.test(e.name)) continue;
		routes.push(...discover(path.join(dir, e.name), `${urlPath}/${e.name}`));
	}
	return routes;
}

const routes = discover();

test('settings discovery finds the admin pages', () => {
	expect(routes).toContain('/settings/chores');
	expect(routes).toContain('/settings/sleep-schedule');
});

for (const route of routes) {
	test(`phone: ${route} fits 390px with short headings`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-phone-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(route);
		await page.waitForLoadState('networkidle');

		const main = page.locator('main');
		const overflowing = await main.evaluate((el) => {
			const edge = el.getBoundingClientRect().right;
			return [...el.querySelectorAll('*')]
				.filter((c) => c.getBoundingClientRect().right > edge + 1)
				.slice(0, 5)
				.map((c) => `${c.tagName}.${c.className}: ${(c.textContent ?? '').slice(0, 20)}`);
		});
		expect(overflowing, 'elements past the right edge').toEqual([]);
		const overflow = await main.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);

		const tall = await page.locator('main h1, main h2, main h3').evaluateAll((els) =>
			els
				.map((el) => {
					const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
					return {
						text: el.textContent?.trim(),
						lines: el.getBoundingClientRect().height / lineHeight
					};
				})
				.filter((h) => h.lines > 3.5)
		);
		expect(tall, 'headings wrap onto more than 3 lines').toEqual([]);
	});
}

const forms = [
	{ name: 'chore', path: '/settings/chores', open: 'Add chore', form: 'chore-form' },
	{ name: 'reward', path: '/settings/rewards', open: 'Add reward', form: 'reward-form' },
	{ name: 'family member', path: '/settings/family', open: 'Add person', form: 'member-form' }
];

for (const f of forms) {
	test(`phone: the ${f.name} form fits the screen width`, async ({ page }, info) => {
		await signInAsAdult(page, `e2e-phone-form-${info.project.name}`);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(f.path);
		await page.getByRole('button', { name: f.open }).click();
		const form = page.locator(`[data-testid="${f.form}"], form`).first();
		await expect(form).toBeVisible();
		const offenders = await form.evaluate((el) =>
			[...el.querySelectorAll('*')]
				.filter((c) => c.getBoundingClientRect().right > window.innerWidth + 1)
				.map((c) => c.tagName + ':' + (c.textContent ?? '').slice(0, 20))
		);
		expect(offenders, 'controls past the right edge').toEqual([]);
	});
}

// hub-ea5.8: the flows a plain page load never reaches: provider forms, the folder form and sheets.
const noSidewaysScroll = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Controls of `root` that poke past the screen edge. */
const pastEdge = (root: Locator) =>
	root.evaluate((el) =>
		[...el.querySelectorAll('*')]
			.filter((c) => c.getBoundingClientRect().right > window.innerWidth + 1)
			.map((c) => `${c.tagName}:${(c.textContent ?? '').slice(0, 20)}`)
	);

async function expectInViewport(locator: Locator, page: Page) {
	await locator.scrollIntoViewIfNeeded();
	const box = (await locator.boundingBox())!;
	const height = page.viewportSize()!.height;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(height);
	expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.describe('phone flows', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('phone: the calendar connection forms fit and use the right keyboards', async ({
		page
	}, info) => {
		await signInAsAdult(page, `e2e-phone-cal-${info.project.name}`);
		await page.route('**/api/calendar/google/start', (route) =>
			route.fulfill({ json: { url: new URL('/healthz', page.url()).href, state: 's' } })
		);
		await page.goto('/settings/calendars');
		const sheet = page.getByTestId('add-connection');
		const open = async (name: RegExp) => {
			await page.getByRole('button', { name: 'Add connection' }).click();
			await page.getByRole('button', { name }).click();
			await expect(sheet).toBeVisible();
		};
		const fits = async () => {
			expect(await pastEdge(sheet)).toEqual([]);
			expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
		};

		await open(/Google/);
		await fits();
		await expectInViewport(page.getByRole('button', { name: 'Connect' }), page);
		await page.getByRole('button', { name: 'Connect' }).click();
		const paste = page.getByLabel('Address you landed on');
		await paste.fill(
			'http://127.0.0.1:9004/?state=s&code=4/0AbCdEfGhIjKlMnOpQrStUvWxYz&scope=https://x'
		);
		await fits();
		await expect(paste).toHaveAttribute('inputmode', 'url');
		await expect(paste).toHaveAttribute('autocapitalize', 'off');
		await expectInViewport(page.getByRole('button', { name: 'Finish' }), page);
		await page.getByRole('button', { name: 'Back' }).click();

		await page.getByRole('button', { name: /iCloud/ }).click();
		await page.getByLabel('Apple ID').fill('someone.with.a.long.address@example.com');
		await page.getByText('How do I get this?').click();
		await fits();
		const apple = page.getByLabel('Apple ID');
		await expect(apple).toHaveAttribute('type', 'email');
		await expect(apple).toHaveAttribute('inputmode', 'email');
		await expect(apple).toHaveAttribute('autocapitalize', 'off');
		const password = page.getByLabel('App-specific password');
		await expect(password).toHaveAttribute('autocapitalize', 'off');
		await expect(password).toHaveAttribute('spellcheck', 'false');
		await expectInViewport(page.getByRole('button', { name: 'Connect' }), page);
		await page.getByRole('button', { name: 'Back' }).click();

		await page.getByRole('button', { name: /Subscription link/ }).click();
		await page
			.getByLabel('Calendar link')
			.fill('webcal://calendar.example.com/schools/team/schedule.ics');
		await fits();
		await expect(page.getByLabel('Calendar link')).toHaveAttribute('inputmode', 'url');
		await expectInViewport(page.getByRole('button', { name: 'Add', exact: true }), page);
	});

	test('phone: the reconnect warning wraps a long calendar name', async ({ page }, info) => {
		const id = `e2e-phone-reauth-${info.project.name}`;
		await signInAsAdult(page, `${id}-adult`);
		const db = new Database('data/hub.db');
		db.pragma('busy_timeout = 5000');
		db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(id);
		db.prepare(
			"INSERT INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES (?, 'google', ?, '[]', ?)"
		).run(id, `Grandmother Wigglesworth's Google ${id.slice(-30)}`, Date.now());
		const key = 'calendar.sync.status';
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
			{ value: string } | undefined;
		const all = row ? JSON.parse(row.value) : {};
		all[id] = {
			lastAttemptAt: Date.now(),
			lastSuccessAt: Date.now(),
			lastError: 'x',
			needsReauth: true
		};
		db.prepare(
			'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		).run(key, JSON.stringify(all), Date.now());
		try {
			await page.goto('/settings/calendars');
			const banner = page
				.getByTestId('reauth-banner')
				.getByRole('listitem')
				.filter({ hasText: id.slice(-30) });
			await expect(banner).toBeVisible();
			expect(await pastEdge(banner)).toEqual([]);
			await expectInViewport(banner.getByRole('button', { name: 'Reconnect' }), page);
			// Not one word per line: the message is wider than a few characters.
			const message = banner.getByRole('status');
			const lines = await message.evaluate(
				(el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)
			);
			expect(lines).toBeLessThanOrEqual(7);
		} finally {
			db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(id);
			delete all[id];
			db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(all), key);
			db.close();
		}
	});

	test('phone: the add-folder form fits and the path gets a URL-style keyboard', async ({
		page
	}, info) => {
		await signInAsAdult(page, `e2e-phone-photo-${info.project.name}`);
		await page.goto('/settings/photo-library');
		const form = page.getByTestId('add-folder');
		await page.getByLabel('Folder path').fill('/mnt/user/Photos/Family/2026/Summer/Holiday');
		expect(await pastEdge(form)).toEqual([]);
		expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
		const path = page.getByLabel('Folder path');
		await expect(path).toHaveAttribute('inputmode', 'url');
		await expect(path).toHaveAttribute('autocapitalize', 'off');
		await expect(path).toHaveAttribute('spellcheck', 'false');
		await expectInViewport(page.getByRole('button', { name: 'Add folder' }), page);
	});

	test('phone: the reject and redeem sheets stay on screen and scroll', async ({ page }, info) => {
		await signInAsAdult(page, `e2e-phone-sheets-${info.project.name}`);
		const request = page.request;
		const stamp = Date.now() % 1e9;
		const member = await (
			await request.post('/api/members', {
				data: { name: `Pip ${stamp}`, role: 'child', color: 'member-3', avatar: '🐸' }
			})
		).json();
		const chore = await (
			await request.post('/api/chores', {
				data: {
					title: 'Water the plants in the garden',
					icon: '🪴',
					stars: 2,
					memberIds: [member.id],
					schedule: { type: 'daily' }
				}
			})
		).json();
		await request.post(`/api/chores/${chore.id}/complete`, { data: { memberId: member.id } });
		const reward = await (
			await request.post('/api/rewards', { data: { title: `Kite ${stamp}`, cost: 5, image: '🪁' } })
		).json();
		await request.put(`/api/members/${member.id}/goal`, { data: { rewardId: reward.id } });
		await request.post(`/api/members/${member.id}/bonus`, { data: { delta: 7, note: 'seed' } });

		await page.goto('/settings/approvals');
		const card = page.locator(`[data-testid="child-card"][data-member="${member.id}"]`);
		// Open it from the bottom of a scrolled page, where a sheet used to land off-screen.
		await card.getByTestId('redeem').scrollIntoViewIfNeeded();

		for (const [open, sheetId, primary] of [
			['reject', 'reject-sheet', 'reject-confirm'],
			['redeem', 'redeem-sheet', 'redeem-confirm']
		] as const) {
			await card.getByTestId(open).click();
			const sheet = page.getByTestId(sheetId);
			await expect(sheet).toBeVisible();
			await page.waitForTimeout(500); // the slide-in settles
			expect(await pastEdge(sheet)).toEqual([]);
			await expectInViewport(page.getByTestId(primary), page);
			const box = (await sheet.boundingBox())!;
			expect(box.y).toBeGreaterThanOrEqual(0);

			// A short screen (keyboard up): the sheet scrolls inside itself, the button stays reachable.
			await page.setViewportSize({ width: 390, height: 300 });
			expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
			await expectInViewport(page.getByTestId(primary), page);
			await page.setViewportSize({ width: 390, height: 844 });
			await sheet.getByRole('button', { name: 'Cancel' }).click();
		}
		await expect(page.getByTestId('reject-sheet')).toHaveCount(0);
	});
});
