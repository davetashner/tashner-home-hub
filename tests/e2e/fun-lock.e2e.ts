import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { expectTappable } from './tap';
import { DB_PATH } from './data-dir';

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * A synthetic kid whose daily job "Dishes" was created 4 days ago and never done, so the last few
 * days were missed. The judging baseline is moved back so those days count.
 */
async function seedMissed(page: Page, label: string) {
	await signInAsAdult(page, `adult-fun-${label.replace(/\W/g, '')}`);
	const request = page.request;
	const member = await (
		await request.post('/api/members', {
			data: { name: `Mira ${Date.now() % 1e9}`, role: 'child', color: 'member-2', avatar: '🦊' }
		})
	).json();
	trackMember(member.id);
	const chore = await (
		await request.post('/api/chores', {
			data: {
				title: 'Dishes',
				icon: '🍽️',
				stars: 2,
				memberIds: [member.id],
				requiresApproval: false,
				schedule: { type: 'daily', start: isoDay(Date.now() - 5 * DAY) }
			}
		})
	).json();
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare('UPDATE chores SET created_at = ? WHERE id = ?').run(Date.now() - 4 * DAY, chore.id);
	db.prepare(
		`INSERT INTO settings (key, value) VALUES ('missed_jobs_since', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run(JSON.stringify(isoDay(Date.now() - 6 * DAY)));
	db.close();
	return {
		memberId: member.id as string,
		choreId: chore.id as string,
		name: member.name as string
	};
}

test('a kid with a missed job sees the wait on Games and Music, and finishing today unlocks them', async ({
	page
}, info) => {
	const kid = await seedMissed(page, info.project.name);
	await page.goto(`/games?member=${kid.memberId}`);
	await expect(page.getByRole('heading', { name: 'Finish your jobs first' })).toBeVisible();
	await expect(page.getByTestId('fun-remaining')).toContainText('Dishes');
	await expectTappable(page.getByTestId('fun-go-jobs'), 96);

	await page.goto(`/music?member=${kid.memberId}`);
	await expect(page.getByRole('heading', { name: 'Finish your jobs first' })).toBeVisible();

	const done = await page.request.post(`/api/chores/${kid.choreId}/complete`, {
		data: { memberId: kid.memberId }
	});
	expect(done.ok()).toBe(true);
	await page.goto(`/games?member=${kid.memberId}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible();
	await expect(page.getByTestId('fun-locked')).toHaveCount(0);
});

test('a grown-up unlocks Games and Music from Approvals', async ({ page }, info) => {
	const kid = await seedMissed(page, info.project.name);
	await page.goto(`/games?member=${kid.memberId}`);
	await expect(page.getByTestId('fun-locked')).toBeVisible();

	await page.goto('/settings/approvals');
	const unlock = page.getByTestId(`fun-unlock-${kid.memberId}`);
	await expectTappable(unlock);
	await unlock.click();
	await expect(page.getByTestId(`fun-held-${kid.memberId}`)).toHaveCount(0);

	await page.goto(`/games?member=${kid.memberId}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible();
	await expect(page.getByTestId('fun-locked')).toHaveCount(0);
});
