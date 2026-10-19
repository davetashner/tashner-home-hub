import { expect, test } from '@playwright/test';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';
import { openKid, seedKid } from './kid';
import { expectTappable } from './tap';

/** The allowance rate is one household-wide value on the shared server, so projects take turns. */
const holdRate = () => holdLock('allowance-rate');

test('set the rate, cash out, the kid sees it, then mark it paid @J4.7', async ({ page }, info) => {
	test.setTimeout(120_000);
	const release = await holdRate();
	try {
		await run();
	} finally {
		release();
	}
	async function run() {
		const kid = await seedKid(page, `allowance ${info.project.name}`);
		const bonus = await page.request.post(`/api/members/${kid.memberId}/bonus`, {
			data: { delta: 12, note: 'seed' }
		});
		expect(bonus.ok()).toBe(true);

		await gotoHydrated(page, '/settings/allowance');
		const card = page.locator(`[data-testid="allowance-kid"][data-member="${kid.memberId}"]`);
		// The page loads the rate after mount and applies it when the answer lands; wait for that
		// (the kid card only renders then) so a slow load cannot overwrite the rate typed below.
		await expect(card).toBeVisible();
		// Both wall viewports run this spec at once, so they share one rate: 10 stars = $2.00.
		await page.getByTestId('rate-stars').fill('10');
		await page.getByTestId('rate-money').fill('2.00');
		await expectTappable(page.getByTestId('rate-save'));
		await page.getByTestId('rate-save').click();
		await expect(page.getByTestId('rate-summary')).toContainText('10 stars = $2.00');
		await expect(card.getByTestId('allowance-balance')).toHaveText('$0.00');
		await expectTappable(card.getByTestId('allowance-cashout'));
		await card.getByTestId('allowance-cashout').click();
		await card.getByTestId('allowance-stars-input').fill('10');
		await expect(card.getByTestId('allowance-preview')).toHaveText('= $2.00');
		await card.getByTestId('allowance-confirm').click();
		// Optimistic: the balance shows before the server answers.
		await expect(card.getByTestId('allowance-balance')).toHaveText('$2.00');
		await expect(page.getByTestId('allowance-toast')).toContainText('cashed out $2.00');
		await expect(page.getByTestId('allowance-row').first()).toContainText('Cashed out 10');

		// The kid sees it, read-only, in the reward shop.
		await openKid(page, kid);
		await page.getByTestId('open-shop').click();
		await expect(page.getByTestId('shop-allowance')).toHaveText('Allowance $2.00');

		// A grown-up marks part of it paid.
		await gotoHydrated(page, '/settings/allowance');
		await card.getByTestId('allowance-payout').click();
		await expect(card.getByTestId('allowance-money-input')).toHaveValue('2.00');
		await card.getByTestId('allowance-money-input').fill('0.50');
		await card.getByTestId('allowance-confirm').click();
		await expect(card.getByTestId('allowance-balance')).toHaveText('$1.50');
		await expect(page.getByTestId('allowance-row').first()).toContainText('Paid');

		// Too much is refused with a message, nothing changes.
		await card.getByTestId('allowance-payout').click();
		await card.getByTestId('allowance-money-input').fill('9.00');
		await card.getByTestId('allowance-confirm').click();
		await expect(card.getByTestId('allowance-error')).toContainText('more than the balance');
		await expect(card.getByTestId('allowance-balance')).toHaveText('$1.50');
	}
});
