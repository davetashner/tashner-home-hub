import { expect, test } from '@playwright/test';
import { px } from './tap';
import { signInAsAdult } from './adult';

test('add and edit a reward', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-rewards-${info.project.name}`);
	const name = `Ice cream trip ${Date.now()}`;
	await page.goto('/settings/rewards');
	await page.getByTestId('add-reward').click();
	await page.locator('[data-testid="reward-emoji"][data-emoji="🍦"]').click();
	await page.getByTestId('reward-title').fill(name);
	await page.getByTestId('reward-cost').fill('20');
	await page.getByTestId('reward-save').click();

	const row = page.getByTestId('reward-row').filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(row).toContainText('🍦');
	await expect(row).toContainText('20 ⭐');

	await row.getByRole('button', { name: `Edit ${name}` }).click();
	await page.getByTestId('reward-cost').fill('30');
	await page.getByTestId('reward-save').click();
	await expect(row).toContainText('30 ⭐');

	const box = await row.getByRole('button', { name: `Edit ${name}` }).boundingBox();
	expect(px(box!.height)).toBeGreaterThanOrEqual(60);
});

test('emoji picker tap targets and free-entry validation', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-rewards-emoji-${info.project.name}`);
	await page.goto('/settings/rewards');
	await page.getByTestId('add-reward').click();
	const first = page.getByTestId('reward-emoji').first();
	const box = await first.boundingBox();
	expect(px(box!.width)).toBeGreaterThanOrEqual(60);
	expect(px(box!.height)).toBeGreaterThanOrEqual(60);
	await page.getByTestId('reward-image').fill('Book');
	await page.getByTestId('reward-title').fill('Bad emoji');
	await page.getByTestId('reward-cost').fill('5');
	await page.getByTestId('reward-save').click();
	await expect(page.getByRole('alert')).toContainText('emoji');
});
