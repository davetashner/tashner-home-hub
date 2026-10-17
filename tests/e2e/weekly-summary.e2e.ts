import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';

const addDays = (date: string, n: number) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

/**
 * Synthetic child with chores in the last complete week: Dishes (daily, 2 stars) done on the
 * first three days, Sweep (weekly, on the first day) never done. So due 8, done 3, 5 missed,
 * +6 stars. Stars are moved into that week; cleanup archives the chores and removes the child.
 */
async function seed(page: Page, label: string) {
	await signInAsAdult(page, `adult-ws-${label.replace(/\W/g, '')}`);
	const request = page.request;
	const week = (await (await request.get('/api/summary/weekly')).json()) as { start: string };
	const member = await (
		await request.post('/api/members', {
			data: { name: `Juno ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦉' }
		})
	).json();
	const chore = async (title: string, stars: number, type: string) =>
		(
			await (
				await request.post('/api/chores', {
					data: {
						title,
						stars,
						memberIds: [member.id],
						requiresApproval: false,
						schedule: { type, start: week.start }
					}
				})
			).json()
		).id as string;
	const dishes = await chore('Dishes', 2, 'daily');
	const sweep = await chore('Sweep', 1, 'weekly');
	for (let i = 0; i < 3; i++)
		await request.post(`/api/chores/${dishes}/complete`, {
			data: { memberId: member.id, date: addDays(week.start, i) }
		});
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	db.prepare('UPDATE star_transactions SET created_at = ? WHERE member_id = ?').run(
		Date.parse(`${addDays(week.start, 2)}T12:00:00Z`),
		member.id
	);
	db.close();
	return {
		memberId: member.id as string,
		name: member.name as string,
		cleanup: async () => {
			for (const id of [dishes, sweep]) await request.post(`/api/chores/${id}/archive`);
			await request.delete(`/api/members/${member.id}?confirm=true`);
		}
	};
}

test('an adult sees a child card with the week numbers, on a phone', async ({ page }, info) => {
	const s = await seed(page, info.project.name);
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/settings/weekly-summary');
		const card = page.locator(`[data-testid="summary-card"][data-member="${s.memberId}"]`);
		await expect(card).toBeVisible();
		await expect(card.getByTestId('net')).toHaveText('+6 ⭐');
		await expect(card.getByTestId('stars-line')).toHaveText(
			'Earned 6 · Spent 0 · Removed 0 · Balance 6'
		);
		await expect(card.getByTestId('done-line')).toHaveText('3 of 8 chores done');
		await expect(card.getByTestId('missed-list').locator('li')).toHaveCount(3);

		// First tap after goto: the page may still be hydrating.
		const toggle = card.getByTestId('toggle-missed');
		await expectTappable(toggle);
		await expect(async () => {
			await toggle.click();
			await expect(card.getByTestId('missed-list').locator('li')).toHaveCount(5, { timeout: 1000 });
		}).toPass();
		await expect(toggle).toHaveText('Show fewer');

		const next = page.getByTestId('next-week');
		await expectTappable(page.getByTestId('prev-week'));
		await expectTappable(next);
		await expect(next).toBeEnabled();
		await next.click();
		await expect(page.getByText('This week so far')).toBeVisible();
		await expect(next).toBeDisabled();

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, 'no sideways scroll at 390px').toBeLessThanOrEqual(0);
	} finally {
		await s.cleanup();
	}
});

test('the summary needs a grown-up', async ({ page }) => {
	const res = await page.request.get('/api/summary/weekly');
	expect(res.status()).toBe(401);
	await page.goto('/settings/weekly-summary');
	await expect(page).toHaveURL(/\/unlock/);
});
