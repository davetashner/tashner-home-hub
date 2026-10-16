import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';

test('add and edit a reward', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-rewards-${info.project.name}`);
	const name = `Ice cream trip ${Date.now()}`;
	await page.goto('/settings/rewards');
	await page.getByTestId('add-reward').click();
	await page.getByTestId('reward-image').fill('🍦');
	await page.getByTestId('reward-title').fill(name);
	await page.getByTestId('reward-cost').fill('20');
	await page.getByTestId('reward-save').click();

	const row = page.getByTestId('reward-row').filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(row).toContainText('20 ⭐');

	await row.getByRole('button', { name: `Edit ${name}` }).click();
	await page.getByTestId('reward-cost').fill('30');
	await page.getByTestId('reward-save').click();
	await expect(row).toContainText('30 ⭐');

	const box = await row.getByRole('button', { name: `Edit ${name}` }).boundingBox();
	expect(box!.height).toBeGreaterThanOrEqual(60);
});
