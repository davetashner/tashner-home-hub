import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { seedKid } from './kid';
import { expectTappable } from './tap';

/** Set MONEY_SHOTS=<dir> to save screenshots of the flow for review. */
const shot = (page: Page, name: string) =>
	process.env.MONEY_SHOTS
		? page.screenshot({ path: `${process.env.MONEY_SHOTS}/${name}.png` })
		: Promise.resolve();

/** Money goals (hub-ar4): a kid saves allowance dollars toward something real. */
test('A kid saves toward a money goal and a grown-up marks it bought @J1.14 @J4.8', async ({
	page
}, info) => {
	test.setTimeout(120_000);
	const { memberId } = await seedKid(page, `money ${info.project.name}`);
	const adjust = (cents: number) =>
		page.request.post('/api/allowance/adjust', { data: { memberId, cents, note: 'seed' } });
	expect((await adjust(1250)).ok()).toBe(true);
	await page.context().clearCookies(); // the kid screen needs no adult session

	await gotoHydrated(page, `/chores?member=${memberId}`);
	await shot(page, `${info.project.name}-chores`);
	await page.getByTestId('open-goals').click();
	await page.getByTestId('goals-tab-money').click();
	await expectTappable(page.getByTestId('goals-tab-money'), 60);
	await expect(page.getByTestId('money-empty')).toBeVisible();

	await page.getByTestId('money-new').click();
	await page.getByTestId('money-title').fill('Red bike');
	await page.getByTestId('money-emoji').first().click();
	await expect(page.getByTestId('money-cost')).toHaveText('$20.00');
	const steps = page.getByTestId('money-step');
	for (const t of [steps.nth(0), steps.nth(3), page.getByTestId('money-save')])
		await expectTappable(t, 60);
	await steps.nth(3).click(); // +$10
	await steps.nth(3).click(); // +$10
	await steps.nth(0).click(); // -$10
	await steps.nth(2).click(); // +$1
	await steps.nth(1).click(); // -$1
	await expect(page.getByTestId('money-cost')).toHaveText('$30.00');
	await steps.nth(3).click();
	await expect(page.getByTestId('money-cost')).toHaveText('$40.00');
	await page.getByTestId('money-save').click();

	const card = page.getByTestId('money-card');
	await expect(card).toHaveCount(1);
	await expect(card).toContainText('Red bike');
	await expect(page.getByTestId('money-caption')).toHaveText('$12.50 of $40.00');
	await expect(card).toHaveAttribute('data-reached', 'false');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await shot(page, `${info.project.name}-money-tab`);

	// The allowance reaches the price: reopening the sheet celebrates once.
	await signInAsAdult(page, `adult-money-${info.project.name.replace(/\W/g, '')}`);
	expect((await adjust(2750)).ok()).toBe(true);
	await page.getByTestId('goals-close').click();
	await page.reload();
	await page.getByTestId('open-goals').click();
	await page.getByTestId('goals-tab-money').click();
	await expect(page.getByTestId('money-card')).toHaveAttribute('data-reached', 'true');
	await expect(page.getByTestId('goals-message')).toContainText('You saved enough for Red bike');
	await expect(page.getByTestId('money-reached')).toBeVisible();
	await shot(page, `${info.project.name}-money-reached`);
	await page.getByTestId('goals-close').click();

	// A grown-up marks it bought in Settings > Allowance.
	await gotoHydrated(page, '/settings/allowance');
	const kidCard = page.locator(`[data-testid="allowance-kid"][data-member="${memberId}"]`);
	await expect(kidCard.getByTestId('allowance-balance')).toHaveText('$40.00');
	await expect(kidCard.getByTestId('savings-goal-caption')).toHaveText('$40.00 of $40.00');
	await expectTappable(kidCard.getByTestId('savings-goal-bought'));
	await kidCard.getByTestId('savings-goal-bought').click();
	await expect(kidCard.getByTestId('allowance-balance')).toHaveText('$0.00');
	await expect(page.getByTestId('allowance-toast')).toContainText('Bought Red bike');
	await expect(kidCard.getByTestId('savings-goal-caption')).toContainText('Bought for $40.00');
	await shot(page, `${info.project.name}-allowance`);
});
