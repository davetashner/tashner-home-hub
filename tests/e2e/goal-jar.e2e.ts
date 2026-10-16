import { expect, test, type Page } from '@playwright/test';
import { openKid, seedKid, stubAudio, type KidSeed } from './kid';

/** A synthetic 5-star reward set as the kid's goal. The kid starts with 2 approved stars. */
async function seedGoal(page: Page, s: KidSeed): Promise<string> {
	const title = `Park picnic ${Date.now() % 1e9}`;
	const reward = await (
		await page.request.post('/api/rewards', { data: { title, cost: 5, image: '🧺' } })
	).json();
	const res = await page.request.put(`/api/members/${s.memberId}/goal`, {
		data: { rewardId: reward.id }
	});
	expect(res.ok()).toBe(true);
	return title;
}

async function bonus(page: Page, s: KidSeed, delta: number) {
	const res = await page.request.post(`/api/members/${s.memberId}/bonus`, {
		data: { delta, note: 'Test bonus' }
	});
	expect(res.ok()).toBe(true);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test('goal jar fills toward the cost and celebrates once per reaching', async ({ page }, info) => {
	const notes = await stubAudio(page);
	const s = await seedKid(page, `goal ${info.project.name}`);
	const title = await seedGoal(page, s);
	await openKid(page, s);

	const goal = page.getByTestId('jar-goal');
	await expect(goal).toContainText(title);
	await expect(page.getByTestId('goal-caption')).toHaveText('2 of 5 stars');
	await expect(goal).toContainText('3 more to go');
	await expect(goal).toHaveAttribute('data-reached', 'false');
	await expect(goal).toBeInViewport();
	await page.waitForTimeout(600);
	await expect(page.getByTestId('goal-earned')).toHaveCount(0);

	// A grown-up's bonus reaches the goal: the big party, with sound.
	await bonus(page, s, 3);
	await expect(page.getByTestId('goal-caption')).toHaveText('5 of 5 stars');
	await expect(goal).toHaveAttribute('data-reached', 'true');
	const banner = page.getByTestId('goal-earned');
	await expect(banner).toContainText('You earned it!');
	await expect(banner).toContainText(title);
	await expect.poll(notes).toBeGreaterThan(0);
	await expect(banner).toHaveCount(0, { timeout: 7000 });

	// Same reaching: no second party after a reload.
	await page.reload();
	await expect(page.getByTestId('goal-caption')).toHaveText('5 of 5 stars');
	await page.waitForTimeout(800);
	await expect(page.getByTestId('goal-earned')).toHaveCount(0);

	// Dropping below and reaching again celebrates again.
	await bonus(page, s, -3);
	await expect(page.getByTestId('goal-caption')).toHaveText('2 of 5 stars');
	await bonus(page, s, 3);
	await expect(page.getByTestId('goal-earned')).toContainText('You earned it!');
});

test('grown-ups see a reached goal on the approvals screen', async ({ page }, info) => {
	const s = await seedKid(page, `goaladult ${info.project.name}`);
	const title = await seedGoal(page, s);
	await page.goto('/settings/approvals');
	const card = page.getByTestId('child-card').and(page.locator(`[data-member="${s.memberId}"]`));
	await expect(card).toBeVisible();
	await expect(card.getByTestId(`goal-reached-${s.memberId}`)).toHaveCount(0);
	await page.request.post(`/api/members/${s.memberId}/bonus`, {
		data: { delta: 3, note: 'Test bonus' }
	});
	await page.reload();
	await expect(card.getByTestId(`goal-reached-${s.memberId}`)).toContainText(`earned ${title}`);
});
