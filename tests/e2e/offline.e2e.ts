import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import Database from 'better-sqlite3';

// The service worker is off for automated browsers unless a test opts in (see lib/offline/client).
test.use({ serviceWorkers: 'allow' });

/** Own source and event (idempotent), so parallel files that seed the shared calendar cannot collide. */
function seedOwnEvent(): void {
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES ('e2e-off-source', 'ics', 'Offline test', '[]', ?)"
	).run(Date.now());
	const now = new Date(); // all-day events are the UTC midnight of the local date
	const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	db.prepare(
		`INSERT OR REPLACE INTO events (id, source_id, external_id, title, starts_at, ends_at, all_day, location, notes, member_ids)
		 VALUES ('e2e-off-ev', 'e2e-off-source', 'ext', 'Offline picnic', ?, ?, 1, NULL, NULL, '[]')`
	).run(start, start + 86_400_000);
	db.close();
}

interface Seed {
	memberId: string;
	choreId: string;
	adult: string;
}

async function seed(page: Page, label: string): Promise<Seed> {
	const adult = `adult-off-${label.replace(/\W/g, '')}`;
	await signInAsAdult(page, adult);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Offy ${Date.now() % 1e9}`, role: 'child', color: 'member-3', avatar: '🐢' }
		})
	).json();
	const chore = await (
		await page.request.post('/api/chores', {
			data: {
				title: 'Water plants',
				icon: '🪴',
				stars: 3,
				timeOfDay: 'morning',
				memberIds: [member.id],
				schedule: { type: 'daily' }
			}
		})
	).json();
	await page.context().clearCookies(); // the kid screen needs no adult session
	return { memberId: member.id, choreId: chore.id, adult };
}

const card = (page: Page) =>
	page
		.getByTestId('chore-card')
		.filter({ has: page.getByRole('heading', { name: 'Water plants' }) });

test('screens render from saved copies offline and the badge clears on recovery', async ({
	page,
	context
}, info) => {
	await page.addInitScript(() => localStorage.setItem('hub.sw', 'on'));
	seedOwnEvent();
	const s = await seed(page, info.project.name);
	const chores = `/chores?member=${s.memberId}`;

	// Warm up: let the worker take control, then visit each screen under its control.
	await page.goto(chores);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await page.goto('/calendar');
	await expect(page.getByText('Offline picnic').first()).toBeVisible();
	await page.goto(chores);
	await expect(card(page)).toBeVisible();
	await page.goto('/calendar');
	await expect(page.getByText('Offline picnic').first()).toBeVisible();
	await expect(page.getByTestId('offline-badge')).toHaveCount(0);

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByText('Offline picnic').first()).toBeVisible();
	await expect(page.getByTestId('offline-badge')).toContainText('Offline');

	await page.goto(chores);
	await expect(card(page)).toBeVisible();
	await expect(page.getByTestId('offline-badge')).toBeVisible();

	await context.setOffline(false);
	await expect(page.getByTestId('offline-badge')).toHaveCount(0);
});
