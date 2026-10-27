import { expect, test } from '@playwright/test';
import { openKid, seedKid } from './kid';

test('a kid names their own star goals, keeps several and picks one @J1.13', async ({
	page
}, info) => {
	const s = await seedKid(page, `own goals ${info.project.name}`);
	await openKid(page, s);

	// Make a goal: a name, a picture and a star price (2 stars is what the kid has).
	await page.getByTestId('open-goals').click();
	await expect(page.getByTestId('goals-sheet')).toBeVisible();
	await page.getByTestId('goal-new').click();
	await page.getByTestId('goal-title').fill('Lego castle');
	await page.getByTestId('goal-emoji').first().click();
	await page.getByRole('button', { name: '10 fewer' }).click();
	await page.getByRole('button', { name: '10 fewer' }).click();
	await page.getByTestId('goal-cost-up').click();
	await expect(page.getByTestId('goal-cost')).toHaveText('2');
	await page.getByTestId('goal-save').click();
	await expect(page.getByTestId('goal-card')).toHaveCount(1);
	await page.getByTestId('goals-close').click();

	const jar = page.getByTestId('jar-goal');
	await expect(jar).toContainText('Lego castle');
	await expect(page.getByTestId('goal-caption')).toHaveText('2 of 2 stars');
	await expect(jar).toHaveAttribute('data-reached', 'true');

	// A second goal becomes current; the first is one tap away.
	await page.getByTestId('open-goals').click();
	await page.getByTestId('goal-new').click();
	await page.getByTestId('goal-title').fill('Bike bell');
	await page.getByTestId('goal-save').click();
	await expect(page.getByTestId('goal-card')).toHaveCount(2);
	await page
		.getByTestId('goal-card')
		.filter({ hasText: 'Lego castle' })
		.getByTestId('goal-pick')
		.click();
	await page.getByTestId('goals-close').click();
	await expect(jar).toContainText('Lego castle');

	// Redeeming still asks a grown-up for the PIN; the custom goal is in the shop for its kid.
	await page.getByTestId('open-shop').click();
	await page
		.getByTestId('shop-card')
		.filter({ hasText: 'Lego castle' })
		.getByTestId('shop-get-now')
		.click();
	await page.getByTestId('shop-confirm-yes').click();
	await expect(page.getByTestId('shop-pin')).toBeVisible();
});
