import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, PIN } from './adult';
import { openKid, seedKid } from './kid';
import { expectTappable } from './tap';

test.beforeAll(ensureHousehold);

interface Reward {
	id: string;
	title: string;
}

async function reward(page: Page, title: string, cost: number, image: string): Promise<Reward> {
	const res = await page.request.post('/api/rewards', { data: { title, cost, image } });
	expect(res.status()).toBe(201);
	return { id: (await res.json()).id as string, title };
}

const stars = async (page: Page, memberId: string) =>
	(await (await page.request.get(`/api/members/${memberId}/stars`)).json()).balance as number;

test('shop cards, make it my goal, and get it now with a preview then the PIN @J4.1 @J4.3', async ({
	page
}, info) => {
	const kid = await seedKid(page, `shop ${info.project.name}`);
	const stamp = `${info.project.name}-${Date.now() % 1e9}`;
	const made: Reward[] = [];
	try {
		const bonus = await page.request.post(`/api/members/${kid.memberId}/bonus`, {
			data: { delta: 8, note: 'seed' }
		});
		expect(bonus.ok()).toBe(true);
		const small = await reward(page, `Kite ${stamp}`, 4, '🪁');
		const lego = await reward(page, `LEGO ${stamp}`, 40, '🧱');
		const big = await reward(page, `Bike ${stamp}`, 60, '🚲');
		made.push(small, lego, big);
		const set = await page.request.put(`/api/members/${kid.memberId}/goal`, {
			data: { rewardId: lego.id }
		});
		expect(set.ok()).toBe(true);
		expect(await stars(page, kid.memberId)).toBe(10);

		await openKid(page, kid);
		const shop = page.getByTestId('reward-shop');
		await page.getByTestId('open-shop').click();
		await expect(shop).toBeVisible();

		const card = (r: Reward) => shop.locator(`[data-reward="${r.id}"]`);
		await expect(card(small)).toContainText('You have enough!');
		await expect(card(small)).toHaveAttribute('data-size', 'small');
		await expect(card(lego)).toContainText('30 more stars');
		await expect(card(lego)).toHaveAttribute('data-goal', 'true');
		await expect(card(big)).toContainText('50 more stars');
		await expect(card(big)).toHaveAttribute('data-size', 'big');
		await expect(card(big).getByTestId('shop-get-now')).toHaveCount(0);

		// Make it my goal changes the goal.
		const pick = card(big).getByTestId('shop-make-goal');
		await expectTappable(pick);
		await pick.click();
		await expect(card(big)).toHaveAttribute('data-goal', 'true');
		await expect(card(lego)).toHaveAttribute('data-goal', 'false');
		await expect
			.poll(async () => {
				const g = await (await page.request.get(`/api/members/${kid.memberId}/goal`)).json();
				return g.reward.id;
			})
			.toBe(big.id);

		// Get it now shows the effect on the big goal, then asks for the PIN.
		await card(small).getByTestId('shop-get-now').click();
		await expect(page.getByTestId('shop-effect')).toContainText(
			`Your ${big.title} goal goes from 10/60 to 6/60`
		);
		await page.getByTestId('shop-confirm-yes').click();
		await expect(page.getByTestId('shop-pin')).toBeVisible();
		// Several grown-ups show a picker, one goes straight to the pad (it depends on which other
		// specs ran first against the shared household); the baseline adult has the standard PIN.
		const baseline = page.getByRole('button', { name: 'Baseline Adult' });
		const one = page.getByRole('button', { name: '1', exact: true });
		await expect(baseline.or(one)).toBeVisible();
		if (await baseline.isVisible()) await baseline.click();
		for (const digit of PIN) await page.getByRole('button', { name: digit, exact: true }).click();
		await page.getByRole('button', { name: 'Enter PIN' }).click();
		await expect(page.getByTestId('shop-message')).toContainText(`Enjoy your ${small.title}`);
		await expect.poll(() => stars(page, kid.memberId)).toBe(6);
	} finally {
		for (const r of made) {
			const res = await page.request.post(`/api/rewards/${r.id}/archive`, { data: {} });
			expect(res.ok()).toBe(true);
		}
	}
});
