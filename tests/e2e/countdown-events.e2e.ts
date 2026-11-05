import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { DB_PATH } from './data-dir';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

// CD-4: count down to a calendar event from its sheet. Each project uses its own far-off year and
// its own calendar source, so these countdowns never reach today's home screen in other tests.
test.beforeAll(ensureHousehold);

const PROJECTS = [
	'wall-landscape-1440p',
	'wall-portrait-1440p',
	'iphone-webkit',
	'ipad-portrait-webkit',
	'ipad-landscape-webkit'
];

function seed(tag: string, year: number) {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	const source = `e2e-cd-src-${tag}`;
	db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(source);
	db.prepare(
		"INSERT INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES (?, 'ics', 'Family', ?, ?)"
	).run(source, JSON.stringify([{ externalId: `cal-${tag}`, name: 'Family' }]), Date.now());
	// All day on June 13: 3 days after the frozen "today" of June 10.
	db.prepare(
		`INSERT INTO events (id, source_id, external_id, title, starts_at, ends_at, all_day, member_ids)
		 VALUES (?, ?, ?, ?, ?, ?, 1, '[]')`
	).run(
		`e2e-cd-ev-${tag}`,
		source,
		`cal-${tag}::play`,
		`School play ${tag}`,
		Date.UTC(year, 5, 13),
		Date.UTC(year, 5, 14)
	);
	db.close();
	return source;
}

test('anyone can count down to a calendar event from its sheet @J0.4', async ({ page }, info) => {
	const tag = info.project.name;
	const year = 2061 + Math.max(0, PROJECTS.indexOf(tag));
	const source = seed(tag, year);
	await page.clock.setFixedTime(new Date(`${year}-06-10T12:00:00`));
	try {
		// Not signed in: a kid at the wall.
		await gotoHydrated(page, '/calendar');
		await page
			.getByRole('button', { name: new RegExp(`School play ${tag}`) })
			.first()
			.click();
		const sheet = page.getByRole('dialog');
		const panel = sheet.getByTestId('event-countdown');
		await expect(panel).toContainText('3 days to go');
		const start = panel.getByTestId('event-countdown-start');
		await expectTappable(start);
		await start.click();
		await expect(panel).toContainText('Counting down on Home');
		await expect(start).toHaveCount(0);

		await gotoHydrated(page, '/');
		const pill = page.getByTestId('home-countdown').filter({ hasText: `School play ${tag}` });
		await expect(pill).toContainText('3 days');

		// The event moves two days later: the countdown follows.
		const db = new Database(DB_PATH);
		db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?').run(
			Date.UTC(year, 5, 15),
			Date.UTC(year, 5, 16),
			`e2e-cd-ev-${tag}`
		);
		db.close();
		await gotoHydrated(page, '/');
		await expect(pill).toContainText('5 days');

		await signInAsAdult(page, `e2e-cd-events-${tag}`);
		await gotoHydrated(page, '/settings/countdowns');
		await expect(
			page.getByTestId('countdown-row').filter({ hasText: `School play ${tag}` })
		).toContainText('From the calendar');
	} finally {
		const db = new Database(DB_PATH);
		db.prepare('DELETE FROM countdowns WHERE event_source_id = ?').run(source);
		db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(source);
		db.close();
	}
});
