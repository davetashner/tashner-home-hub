import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

interface Seed {
	memberId: string;
	name: string;
	reward: string;
}

/** Synthetic child with 7 stars and a 5-star goal. Leaves the page signed in. */
async function seed(page: Page, label: string): Promise<Seed> {
	await signInAsAdult(page, `adult-rd-${label.replace(/\W/g, '')}`);
	const request = page.request;
	const stamp = Date.now() % 1e9;
	const name = `Wren ${stamp}`;
	const reward = `Kite ${label} ${stamp}`;
	const member = await (
		await request.post('/api/members', {
			data: { name, role: 'child', color: 'member-2', avatar: '🦊' }
		})
	).json();
	const r = await (
		await request.post('/api/rewards', { data: { title: reward, cost: 5, image: '🪁' } })
	).json();
	await request.put(`/api/members/${member.id}/goal`, { data: { rewardId: r.id } });
	await request.post(`/api/members/${member.id}/bonus`, { data: { delta: 7, note: 'seed' } });
	return { memberId: member.id, name, reward };
}

const card = (page: Page, s: Seed) =>
	page.locator(`[data-testid="child-card"][data-member="${s.memberId}"]`);
const balance = async (page: Page, s: Seed) =>
	(await (await page.request.get(`/api/members/${s.memberId}/stars`)).json()).balance as number;

test('a grown-up redeems the goal, stars come off, and it is logged @J4.4', async ({
	page
}, info) => {
	const s = await seed(page, `ok ${info.project.name}`);
	await gotoHydrated(page, '/settings/approvals');
	const redeem = card(page, s).getByTestId('redeem');
	await expect(redeem).toBeVisible();
	await expectTappable(redeem);
	await redeem.click();

	const sheet = page.getByTestId('redeem-sheet');
	await expect(sheet).toContainText(`Redeem ${s.reward} for ${s.name}?`);
	await expect(page.getByTestId('redeem-summary')).toContainText('will have 2');
	await expectTappable(page.getByTestId('redeem-confirm'));
	await page.getByTestId('redeem-confirm').click();

	await expect(page.getByTestId('toast')).toContainText(`Redeemed ${s.reward}`);
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText('2 ⭐');
	await expect(card(page, s).getByTestId(`goal-reached-${s.memberId}`)).toHaveCount(0);
	expect(await balance(page, s)).toBe(2);

	await page.getByTestId('redemption-log-link').click();
	await expect(page).toHaveURL(/\/settings\/redemptions/);
	const row = page.getByTestId('redemption-row').filter({ hasText: s.reward });
	await expect(row).toContainText(`${s.name}: ${s.reward}`);
	await expect(row).toContainText('−5 ⭐');
	await expect(row).toContainText('by Test Adult');
});

test('a failed redeem puts the stars back @J4.5', async ({ page }, info) => {
	const s = await seed(page, `fail ${info.project.name}`);
	await gotoHydrated(page, '/settings/approvals');
	await page.route('**/api/redemptions', (route) => route.fulfill({ status: 500 }));
	await card(page, s).getByTestId('redeem').click();
	await page.getByTestId('redeem-confirm').click();
	await expect(page.getByTestId('toast')).toContainText("didn't go through");
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText('7 ⭐');
	await expect(card(page, s).getByTestId(`goal-reached-${s.memberId}`)).toBeVisible();
	expect(await balance(page, s)).toBe(7);
});

test('without a grown-up, nothing can be redeemed or read @J4.4', async ({ page }, info) => {
	const s = await seed(page, `kid ${info.project.name}`);
	const rewards = await (await page.request.get('/api/rewards')).json();
	const reward = (rewards as { id: string; title: string }[]).find((r) => r.title === s.reward)!;
	await page.context().clearCookies();
	const res = await page.request.post('/api/redemptions', {
		data: { memberId: s.memberId, rewardId: reward.id }
	});
	expect(res.status()).toBe(401);
	expect((await page.request.get('/api/redemptions')).status()).toBe(401);
	expect(await balance(page, s)).toBe(7);
	await gotoHydrated(page, '/settings/redemptions');
	await expect(page).toHaveURL(/\/unlock/);
});
