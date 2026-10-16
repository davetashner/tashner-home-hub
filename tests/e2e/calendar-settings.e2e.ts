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

function withDb<T>(f: (db: Database.Database) => T): T {
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	try {
		return f(db);
	} finally {
		db.close();
	}
}

function seed(id: string): void {
	withDb((db) => {
		const m = db.prepare(
			"INSERT OR REPLACE INTO members (id, name, role, color) VALUES (?, ?, 'child', ?)"
		);
		m.run(`${id}-m1`, `Avery ${id}`, 'member-1');
		m.run(`${id}-m2`, `Blake ${id}`, 'member-3');
	});
}

function cleanup(label: string): void {
	withDb((db) => db.prepare('DELETE FROM calendar_sources WHERE label = ?').run(label));
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
	seed(tag);
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

		// Remove the ICS connection through the confirm step.
		if (info.title.includes('phone')) await noSideScroll(page);
		await row.getByRole('button', { name: 'Delete' }).click();
		await expect(row.getByText(`Remove ${label}?`)).toBeVisible();
		await row.getByRole('button', { name: 'Yes, remove' }).click();
		await expect(page.getByRole('listitem').filter({ hasText: label })).toHaveCount(0);
	} finally {
		cleanup(label);
		withDb((db) => db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(`${tag}-short`));
	}
}

test('add a link, map it, and see its health', async ({ page }, info) => {
	await runFlow(page, info);
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
	test('phone: the same guided flow fits with no sideways scrolling', async ({ page }, info) => {
		await runFlow(page, info);
	});
});
