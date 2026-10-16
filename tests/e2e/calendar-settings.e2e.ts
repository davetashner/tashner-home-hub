import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Synthetic School
BEGIN:VEVENT
UID:cs-1@example.com
SUMMARY:Picture day
DTSTART;VALUE=DATE:20300901
END:VEVENT
END:VCALENDAR
`;

const STATUS_KEY = 'calendar.sync.status';

function withDb<T>(f: (db: Database.Database) => T): T {
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	try {
		return f(db);
	} finally {
		db.close();
	}
}

function seed(id: string, memberIds: string[]): { googleId: string } {
	const googleId = `${id}-google`;
	withDb((db) => {
		const m = db.prepare(
			"INSERT OR REPLACE INTO members (id, name, role, color) VALUES (?, ?, 'child', ?)"
		);
		m.run(memberIds[0], `Avery ${id}`, 'member-1');
		m.run(memberIds[1], `Blake ${id}`, 'member-3');
		db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(googleId);
		db.prepare(
			"INSERT INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES (?, 'google', ?, ?, ?)"
		).run(
			googleId,
			`Mom's Google ${id}`,
			JSON.stringify([
				{ externalId: 'primary', name: 'Mom (primary)', memberId: null },
				{ externalId: 'birthdays', name: 'Birthdays', memberId: null, selected: false }
			]),
			Date.now() - 3 * 60_000
		);
	});
	return { googleId };
}

function setReauth(sourceId: string, needsReauth: boolean): void {
	withDb((db) => {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(STATUS_KEY) as
			{ value: string } | undefined;
		const all: Record<string, unknown> = row ? JSON.parse(row.value) : {};
		if (needsReauth)
			all[sourceId] = {
				lastAttemptAt: Date.now(),
				lastSuccessAt: Date.now() - 3 * 60_000,
				lastError: 'Google rejected the saved sign-in',
				needsReauth: true
			};
		else delete all[sourceId];
		db.prepare(
			'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		).run(STATUS_KEY, JSON.stringify(all), Date.now());
	});
}

function cleanup(ids: string[]): void {
	withDb((db) => {
		for (const id of ids) db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(id);
	});
	for (const id of ids) setReauth(id, false);
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
	const dir = process.env.SHOTS;
	if (!dir) return;
	for (const theme of ['day', 'night'] as const) {
		await page.evaluate((t) => {
			if (t === 'night') document.documentElement.dataset.theme = 'night';
			else delete document.documentElement.dataset.theme;
			window.scrollTo(0, 0);
			for (const el of document.querySelectorAll('*')) el.scrollTop = 0;
		}, theme);
		await page.screenshot({
			path: `${dir}/calsettings-${info.title.includes('phone') ? 'phone' : info.project.name}-${name}-${theme}.png`,
			fullPage: true
		});
	}
	await page.evaluate(() => delete document.documentElement.dataset.theme);
}

/** Every button sits fully inside the viewport, and a short label like "Family" is never clipped. */
async function expectFitsPhone(page: Page, tag: string): Promise<void> {
	withDb((db) => {
		db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(`${tag}-short`);
		db.prepare(
			"INSERT INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES (?, 'ics', 'Family', '[]', ?)"
		).run(`${tag}-short`, Date.now());
	});
	await page.reload();
	const width = page.viewportSize()!.width;
	await expect(page.getByRole('button', { name: 'Add connection' })).toBeVisible();
	for (const button of await page.getByRole('button').all()) {
		const box = await button.boundingBox();
		if (!box) continue;
		expect(box.x, await button.innerText()).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width, await button.innerText()).toBeLessThanOrEqual(width);
	}
	const labels = await page.getByTestId('source-list').getByText('Family', { exact: true }).all();
	expect(labels.length).toBeGreaterThan(0);
	for (const label of labels) {
		expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
		const box = (await label.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(width);
	}
}

async function noSideScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

let feed: Server;
let feedUrl: string;
test.beforeAll(async () => {
	ensureHousehold();
	feed = createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'text/calendar' }).end(FEED);
	});
	await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r));
	feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/school.ics`;
});
test.afterAll(() => {
	feed.closeAllConnections();
	feed.close();
});

async function runFlow(page: Page, info: TestInfo): Promise<void> {
	const tag = `e2e-cs-${info.project.name}-${info.title.includes('phone') ? 'p' : 'w'}`;
	const label = `School ${tag}`;
	const googleLabel = `Mom's Google ${tag}`;
	const { googleId } = seed(tag, [`${tag}-m1`, `${tag}-m2`]);
	await signInAsAdult(page, `${tag}-adult`);
	// A real sync touches every source in the shared test database (other specs seed their own),
	// so it is stubbed here; the source's health is seeded as if a sync had just succeeded.
	await page.route('**/api/calendar/sync', (route) => route.fulfill({ json: {} }));
	try {
		// The settings menu links here.
		await page.goto('/settings');
		await page.getByRole('link', { name: /Calendars/ }).click();
		await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();

		// Add an ICS subscription against a real local server, then map it to a person.
		const add = page.getByRole('button', { name: 'Add connection' });
		await expectTappable(add);
		await add.click();
		for (const name of ['Google', 'iCloud', 'Subscription link'])
			await expectTappable(page.getByRole('button', { name })); // choice buttons contain the title
		await page.getByRole('button', { name: /Subscription link/ }).click();
		await page.getByLabel('Name this calendar').fill(label);
		await page.getByLabel('Calendar link').fill(feedUrl);
		await shot(page, info, 'add-link');
		await expectTappable(page.getByRole('button', { name: 'Add', exact: true }));
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const picker = page.getByTestId('calendar-picker');
		await expect(picker).toBeVisible();
		await page.getByRole('button', { name: `Avery ${tag}`, exact: true }).click();
		await expectTappable(page.getByRole('button', { name: `Avery ${tag}`, exact: true }));
		await shot(page, info, 'choose-calendars');
		withDb((db) =>
			db
				.prepare('UPDATE calendar_sources SET last_sync_at = ? WHERE label = ?')
				.run(Date.now(), label)
		);
		await picker.getByRole('button', { name: 'Save' }).click();

		const row = page.getByRole('listitem').filter({ hasText: label });
		await expect(row).toBeVisible();
		await expect(row.getByText('OK', { exact: true })).toBeVisible();
		await expect(row.getByText(/Updated (just now|\d+ min ago)/)).toBeVisible();
		await expect(row.getByText('127.0.0.1')).toBeVisible();
		if (info.title.includes('phone')) await expectFitsPhone(page, tag);
		await shot(page, info, 'list');
		if (process.env.SHOTS && info.title.includes('phone')) {
			await row.scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${process.env.SHOTS}/calsettings-phone-list-rows.png` });
		}

		// The mapping persisted: Edit shows Avery pressed.
		await row.getByRole('button', { name: 'Edit' }).click();
		await expect(page.getByRole('button', { name: `Avery ${tag}`, exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expectTappable(page.getByRole('button', { name: 'Sync now' }));
		await page.getByRole('button', { name: 'Sync now' }).click();
		await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
		await expect(row.getByText('OK', { exact: true })).toBeVisible();

		// A connection that needs reconnecting: calm banner on both pages.
		setReauth(googleId, true);
		await page.goto('/settings');
		const banner = page.getByTestId('reauth-banner');
		await expect(banner).toContainText(`${googleLabel} calendar needs reconnecting`);
		const reconnect = banner.locator(`a[href$="reconnect=${googleId}"]`);
		await shot(page, info, 'settings-banner');
		await expectTappable(reconnect);
		await reconnect.click();

		// The link lands straight in the Google reconnect step.
		await expect(page.getByRole('heading', { name: `Reconnect ${googleLabel}` })).toBeVisible();
		let started = 0;
		let finishBody: Record<string, unknown> = {};
		await page.route('**/api/calendar/google/start', async (route) => {
			started++;
			await route.fulfill({
				json: { url: new URL('/healthz', page.url()).href, state: 'state-1' }
			});
		});
		await page.route('**/api/calendar/google/finish', async (route) => {
			finishBody = route.request().postDataJSON();
			setReauth(googleId, false);
			await route.fulfill({
				status: 201,
				json: { id: googleId, provider: 'google', label: googleLabel, calendars: [] }
			});
		});
		await page.getByRole('button', { name: 'Connect' }).click();
		await expect(
			page.getByRole('heading', { name: 'Paste the address you landed on' })
		).toBeVisible();
		expect(started).toBe(1);
		const paste = page.getByLabel('Address you landed on');
		await expectTappable(paste);
		await expect(page.getByText('This site can’t be reached')).toHaveCount(0);
		await shot(page, info, 'google-paste');
		await paste.fill('http://127.0.0.1:9004/?state=state-1&code=4/0AbCdEfGhIjKlMn&scope=x');
		await page.getByRole('button', { name: 'Finish' }).click();
		await expect(page.getByTestId('source-list')).toBeVisible();
		expect(finishBody).toMatchObject({ state: 'state-1', sourceId: googleId });
		await expect(page.getByTestId('reauth-banner').getByText(googleLabel)).toHaveCount(0);
		if (info.title.includes('phone')) await noSideScroll(page);

		// Remove the ICS connection through the confirm step.
		await row.getByRole('button', { name: 'Delete' }).click();
		await expect(row.getByText(`Remove ${label}?`)).toBeVisible();
		await row.getByRole('button', { name: 'Yes, remove' }).click();
		await expect(page.getByRole('listitem').filter({ hasText: label })).toHaveCount(0);
	} finally {
		withDb((db) => db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(`${tag}-short`));
		cleanup([googleId]);
		withDb((db) => db.prepare('DELETE FROM calendar_sources WHERE label = ?').run(label));
	}
}

test('add a link, map it, see health, and reconnect Google', async ({ page }, info) => {
	await runFlow(page, info);
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
	test('phone: the same guided flow fits with no sideways scrolling', async ({ page }, info) => {
		await runFlow(page, info);
	});
});

test('iCloud: shows how to get the password and a friendly rejection inline', async ({
	page
}, info) => {
	const tag = `e2e-cs-${info.project.name}-icloud`;
	await signInAsAdult(page, `${tag}-adult`);
	await page.route('**/api/calendar/sources', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		expect(route.request().postDataJSON()).toMatchObject({
			provider: 'icloud',
			appleId: 'jane@example.com'
		});
		await route.fulfill({
			status: 401,
			json: { message: 'Apple rejected the app-specific password. Make a new one.' }
		});
	});
	await page.goto('/settings/calendars');
	await page.getByRole('button', { name: 'Add connection' }).click();
	await page.getByRole('button', { name: /iCloud/ }).click();
	await page.getByText('How do I get this?').click();
	await expect(page.getByText('App-Specific Passwords').first()).toBeVisible();
	await page.getByLabel('Name this calendar').fill('Dad iCloud');
	await page.getByLabel('Apple ID').fill('jane@example.com');
	await page.getByLabel('App-specific password').fill('abcd-efgh-ijkl-mnop');
	await shot(page, info, 'icloud');
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByRole('alert')).toContainText('Apple rejected the app-specific password');
	await expect(page.getByLabel('Apple ID')).toHaveValue('jane@example.com');
});
