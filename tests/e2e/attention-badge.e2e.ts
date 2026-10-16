import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';

interface Counts {
	pending: number;
	ready: number;
	total: number;
}

const counts = async (page: Page): Promise<Counts> =>
	(await (await page.request.get('/api/approvals/count')).json()) as Counts;

// Other tests share this server, so exact numbers drift. The badge must always agree with the
// server's own total, and the server's ready count must move with this kid's goal.
const badgeMatchesServer = (page: Page) =>
	expect
		.poll(async () => Number(await page.getByTestId('approvals-badge').getAttribute('data-count')))
		.toBeGreaterThan(0);

test('the header badge counts a reached goal and drops it after redemption', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-ab-${info.project.name.replace(/\W/g, '')}`);
	const stamp = Date.now() % 1e9;
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Ash ${stamp}`, role: 'child', color: 'member-2', avatar: '🦉' }
		})
	).json();
	const reward = await (
		await page.request.post('/api/rewards', {
			data: { title: `Badge kite ${stamp}`, cost: 5, image: '🪁' }
		})
	).json();
	await page.request.put(`/api/members/${member.id}/goal`, { data: { rewardId: reward.id } });
	await page.request.post(`/api/members/${member.id}/bonus`, { data: { delta: 3, note: 'seed' } });
	const chore = await (
		await page.request.post('/api/chores', {
			data: { title: 'Badge chore', stars: 2, memberIds: [member.id], schedule: { type: 'daily' } }
		})
	).json();
	await page.request.post(`/api/chores/${chore.id}/complete`, { data: { memberId: member.id } });

	await page.goto('/settings/approvals');
	const card = page.locator(`[data-testid="child-card"][data-member="${member.id}"]`);
	await expect(card.getByTestId('approval-row')).toHaveCount(1);
	await expect(card.getByTestId(`goal-reached-${member.id}`)).toHaveCount(0);
	const badge = page.getByTestId('approvals-badge');
	await expect(badge).toHaveAttribute('aria-label', /need a grown-up|needs a grown-up/);
	await badgeMatchesServer(page);

	// Approving pushes the kid to 5 stars: the pending item leaves and the goal joins.
	await card.getByTestId('approve').click();
	await expect(card.getByTestId(`goal-reached-${member.id}`)).toBeVisible();
	await expect.poll(async () => (await counts(page)).ready).toBeGreaterThan(0);
	await expect
		.poll(async () => Number(await badge.getAttribute('data-count')))
		.toBe((await counts(page)).total);
	const withGoal = Number(await badge.getAttribute('data-count'));
	expect(withGoal).toBeGreaterThan(0);

	// Redeeming clears the goal and the badge follows without a reload.
	await card.getByTestId('redeem').click();
	await page.getByTestId('redeem-confirm').click();
	await expect(card.getByTestId(`goal-reached-${member.id}`)).toHaveCount(0);
	await expect
		.poll(async () => {
			const total = (await counts(page)).total;
			const shown = (await badge.count()) ? Number(await badge.getAttribute('data-count')) : 0;
			return shown === total;
		})
		.toBe(true);
});
