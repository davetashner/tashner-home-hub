import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

test('an adult makes a Siri token, sees it once, then revokes it', async ({ page }, info) => {
	await signInAsAdult(page, 'e2e-siri-adult');
	const name = `Test Phone ${info.project.name.slice(5, 9)}${Date.now().toString(36)}`;
	await page.goto('/settings');
	await page.getByRole('link', { name: /Siri and Shortcuts/ }).click();
	await page.waitForLoadState('networkidle');
	const add = page.getByTestId('new-token');
	await expect(async () => {
		await add.click();
		await expect(page.getByTestId('token-form')).toBeVisible({ timeout: 1000 });
	}).toPass();
	await page.getByTestId('token-name').fill(name);
	await page.getByTestId('token-create').click();

	const secret = (await page.getByTestId('token-secret').textContent())!.trim();
	expect(secret.length).toBeGreaterThanOrEqual(43);
	const copy = (await page.getByTestId('token-copy').boundingBox())!;
	expect(copy.height).toBeGreaterThanOrEqual(60);
	await expect(page.getByTestId('token-secret-card')).toContainText("You'll paste this");

	const row = page.getByTestId('token-row').filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(row).toContainText('never used');
	await expect(row).not.toContainText(secret);

	await row.getByTestId('token-revoke').click();
	await expect(row).toHaveCount(0);
});
