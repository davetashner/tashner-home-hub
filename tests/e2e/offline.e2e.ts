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
				schedule: { type: 'daily' },
				requiresApproval: true
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

test('one child whose chores will not load does not blank the other kids', async ({
	page
}, info) => {
	const s = await seed(page, `${info.project.name}-partial`);
	await signInAsAdult(page, s.adult);
	const other = await (
		await page.request.post('/api/members', {
			data: { name: `Flaky ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();
	await page.request.post('/api/chores', {
		data: {
			title: 'Feed fish',
			icon: '🐟',
			stars: 1,
			timeOfDay: 'morning',
			memberIds: [other.id],
			schedule: { type: 'daily' },
			requiresApproval: true
		}
	});
	await page.context().clearCookies();
	await page.route(`**/api/members/${other.id}/chores?*`, (route) => route.abort());

	await page.goto(`/chores?member=${s.memberId}`);
	await expect(card(page)).toBeVisible();
	await expect(page.getByText('No one is here yet')).toHaveCount(0);
	await expect(page.getByTestId('partial-note')).toBeVisible();
});

test('a routine step tapped offline survives a reload and is saved once back online', async ({
	page,
	context
}, info) => {
	await page.addInitScript(() => localStorage.setItem('hub.sw', 'on'));
	const s = await seed(page, `${info.project.name}-routine`);
	await signInAsAdult(page, s.adult);
	const name = `Offline ${Date.now() % 1e9}`;
	const made = await page.request.post('/api/routines', {
		data: {
			memberId: s.memberId,
			name,
			steps: [
				{ label: 'Pajamas on', icon: 'shirt' },
				{ label: 'Brush teeth', icon: 'toothbrush' }
			]
		}
	});
	expect(made.status()).toBe(201);
	const routine = (await made.json()) as { id: string };
	await page.context().clearCookies();

	const chores = `/chores?member=${s.memberId}`;
	const open = async () => {
		const button = page.getByTestId('routine-button').filter({ hasText: name });
		await expect(async () => {
			await button.click();
			await expect(page.getByTestId('routine-player')).toBeVisible();
		}).toPass();
	};
	const savedSteps = async () => {
		const res = await page.request.get(`/api/routines?date=${await today(page)}`);
		const all = (await res.json()) as { id: string; done: number }[];
		return all.find((r) => r.id === routine.id)?.done;
	};

	await page.goto(chores);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await page.goto(chores); // under the worker's control, so the saved copies are filled
	await expect(page.getByTestId('routine-button').filter({ hasText: name })).toBeVisible();

	await context.setOffline(true);
	await open();
	await page.getByTestId('routine-done').click();
	await expect(page.getByTestId('routine-step')).toContainText('Brush teeth');

	// The tap is parked in IndexedDB (the write queue) a moment after the optimistic update.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<number>((resolve) => {
						const req = indexedDB.open('hub-offline', 1);
						req.onsuccess = () => {
							const get = req.result.transaction('kv').objectStore('kv').get('write-queue');
							get.onsuccess = () => resolve(((get.result as unknown[]) ?? []).length);
						};
					})
			)
		)
		.toBe(1);
	await page.reload(); // the tap is only in the write queue now
	await open();
	await expect(page.getByTestId('routine-step')).toContainText('Brush teeth');

	await context.setOffline(false);
	await expect.poll(savedSteps).toBe(1); // delivered, and once
});

/** Today's date as the kid screen sees it (the browser's local date). */
const today = (page: Page) =>
	page.evaluate(() => {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	});
