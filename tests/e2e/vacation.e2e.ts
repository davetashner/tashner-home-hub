import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';
import { DATA_DIR } from './data-dir';

// Vacation is household-wide and the e2e server is shared, so the range sits years ahead and the
// kid screen's browser clock is moved into it: no other test sees a vacation today.
const START = '2031-06-01';
const BACK = '2031-06-20';
const LOCK = join(DATA_DIR, '.vacation-lock');

/** Vacation is one global value on the shared server, so projects take turns holding it. */
async function holdVacation(): Promise<() => void> {
	mkdirSync(DATA_DIR, { recursive: true });
	for (;;) {
		try {
			mkdirSync(LOCK);
			return () => rmSync(LOCK, { recursive: true, force: true });
		} catch {
			try {
				if (Date.now() - statSync(LOCK).mtimeMs > 90_000) rmSync(LOCK, { recursive: true });
			} catch {
				// released meanwhile
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
}

const INSIDE = new Date('2031-06-10T12:00:00Z');

test('vacation mode pauses the kid board and clearing it restores the to-dos', async ({
	page
}, info) => {
	test.setTimeout(120_000);
	const release = await holdVacation();
	try {
		await run();
	} finally {
		release();
	}
	async function run() {
		await signInAsAdult(page, `adult-vacation-${info.project.name.replace(/\W/g, '')}`);
		const request = page.request;
		const member = (await (
			await request.post('/api/members', {
				data: { name: `Kid A ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
			})
		).json()) as { id: string };
		trackMember(member.id);
		expect(
			(
				await request.post('/api/chores', {
					data: {
						memberIds: [member.id],
						schedule: { type: 'daily' },
						title: 'Hang up towels',
						icon: '🧺',
						kind: 'habit'
					}
				})
			).ok()
		).toBe(true);
		// One finished day, so the paused streak has a number to hold.
		await page.context().clearCookies();
		await gotoHydrated(page, `/chores?member=${member.id}`);
		await page.getByTestId('did-it').first().click();
		await expect(page.getByTestId('streak-badge')).toContainText('1-day habit streak');

		await signInAsAdult(page, `adult-vacation-${info.project.name.replace(/\W/g, '')}`);
		const set = await page.request.put('/api/settings/vacation', {
			data: { start: START, back: BACK }
		});
		expect(set.ok()).toBe(true);
		try {
			await page.context().clearCookies();
			await page.clock.setFixedTime(INSIDE);
			await gotoHydrated(page, `/chores?member=${member.id}`);
			await expect(page.getByTestId('vacation-card')).toBeVisible();
			await expect(page.getByTestId('vacation-card')).toContainText('Vacation mode');
			await expect(page.getByTestId('vacation-streak')).toHaveText('1-day habit streak paused');
			await expect(page.getByTestId('habits')).toHaveCount(0);
			await expect(page.getByTestId('star-jobs')).toHaveCount(0);
		} finally {
			await signInAsAdult(page, `adult-vacation-${info.project.name.replace(/\W/g, '')}`);
			const del = await page.request.delete('/api/settings/vacation', { data: {} });
			expect(`${del.status()} ${await del.text()}`).toMatch(/^200/);
		}

		await page.context().clearCookies();
		await gotoHydrated(page, `/chores?member=${member.id}`);
		await expect(page.getByTestId('vacation-card')).toHaveCount(0);
		await expect(page.getByTestId('habits')).toBeVisible();
	}
});

test('a grown-up sets and ends vacation from Settings', async ({ page }, info) => {
	test.setTimeout(120_000);
	const release = await holdVacation();
	await signInAsAdult(page, `adult-vacation-ui-${info.project.name.replace(/\W/g, '')}`);
	try {
		await gotoHydrated(page, '/settings/vacation');
		await expect(page.getByTestId('vacation-start')).toHaveCount(0);
		await page.getByTestId('vacation-switch').click();
		await expect(page.getByTestId('vacation-switch')).toHaveAttribute('aria-checked', 'true');
		await page.getByTestId('vacation-start').fill(START);
		await page.getByTestId('vacation-back').fill(BACK);
		await expect
			.poll(async () => (await (await page.request.get('/api/settings/vacation')).json()).vacation)
			.toEqual({ start: START, back: BACK });
		// A vacation in the future is removed outright by "End vacation now".
		await page.getByTestId('vacation-end').click();
		await expect(page.getByTestId('vacation-switch')).toHaveAttribute('aria-checked', 'false');
		expect((await (await page.request.get('/api/settings/vacation')).json()).vacation).toBeNull();
	} finally {
		await page.request.delete('/api/settings/vacation', { data: {} });
		release();
	}
});
