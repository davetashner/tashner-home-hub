import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import Database from 'better-sqlite3';

// The service worker is off for automated browsers unless a test opts in (see lib/offline/client).
test.use({ serviceWorkers: 'allow' });

/** An empty source of our own (idempotent): the calendar shows its full view without adding events other files count. */
function seedOwnSource(): void {
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES ('e2e-off-source', 'ics', 'Offline test', '[]', ?)"
	).run(Date.now());
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

test('screens render from saved copies offline and a queued tap is delivered once', async ({
	page,
	context
}, info) => {
	await page.addInitScript(() => localStorage.setItem('hub.sw', 'on'));
	seedOwnSource();
	const s = await seed(page, info.project.name);
	const chores = `/chores?member=${s.memberId}`;

	// Warm up: let the worker take control, then visit each screen under its control.
	await page.goto(chores);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await page.goto('/calendar');
	await expect(page.getByTestId('period-title')).not.toBeEmpty();
	await page.goto(chores);
	await expect(card(page)).toBeVisible();
	await page.goto('/calendar');
	await expect(page.getByTestId('period-title')).not.toBeEmpty();
	await expect(page.getByTestId('offline-badge')).toHaveCount(0);

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByTestId('period-title')).not.toBeEmpty();
	await expect(page.getByTestId('offline-badge')).toContainText('Offline');

	await page.goto(chores);
	await expect(card(page)).toBeVisible();
	await expect(page.getByTestId('offline-badge')).toBeVisible();
	await card(page).getByTestId('did-it').click();
	await expect(card(page)).toHaveAttribute('data-status', 'pending');
	await expect(page.getByTestId('jar-counts')).toContainText('3 waiting');

	await context.setOffline(false);
	await expect(page.getByTestId('offline-badge')).toHaveCount(0);
	await signInAsAdult(page, s.adult);
	await expect
		.poll(async () => {
			const res = await page.request.get(`/api/members/${s.memberId}/stars?limit=1`);
			return ((await res.json()) as { pending: number }).pending;
		})
		.toBe(3); // delivered, and exactly once (not 6)
	await page.waitForTimeout(500);
	const again = await page.request.get(`/api/members/${s.memberId}/stars?limit=1`);
	expect(((await again.json()) as { pending: number }).pending).toBe(3);
});
