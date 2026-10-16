import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';

interface Counts {
	pending: number;
	ready: number;
	total: number;
}

const counts = async (page: Page): Promise<Counts> =>
	(await (await page.request.get('/api/approvals/count')).json()) as Counts;

// Other tests (and the other viewport project) share this server and change the global pending and
// ready counts without telling this page, so the badge can legitimately lag the server. Each attempt
// reloads (the badge recounts on navigation) and compares the badge with a total fetched afterwards;
// it converges as soon as the system is quiet for a moment.
const badgeMatchesServer = (page: Page) =>
	expect(async () => {
		await page.reload();
		const badge = page.getByTestId('approvals-badge');
		await expect(page.getByRole('banner')).toBeVisible();
		const total = (await counts(page)).total;
		if (total === 0) await expect(badge).toHaveCount(0);
		else await expect(badge).toHaveAttribute('data-count', String(total), { timeout: 1000 });
	}).toPass({ timeout: 20_000 });

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
	await expect.poll(async () => (await counts(page)).pending).toBeGreaterThan(0);
	await badgeMatchesServer(page);

	// Approving pushes the kid to 5 stars: the pending item leaves and the goal joins.
	await card.getByTestId('approve').click();
	await expect(card.getByTestId(`goal-reached-${member.id}`)).toBeVisible();
	await expect.poll(async () => (await counts(page)).ready).toBeGreaterThan(0);
	await badgeMatchesServer(page);
	expect(Number(await badge.getAttribute('data-count'))).toBeGreaterThan(0);

	// Redeeming clears the goal and the badge recounts to match the server.
	await card.getByTestId('redeem').click();
	await page.getByTestId('redeem-confirm').click();
	await expect(card.getByTestId(`goal-reached-${member.id}`)).toHaveCount(0);
	await badgeMatchesServer(page);
});
