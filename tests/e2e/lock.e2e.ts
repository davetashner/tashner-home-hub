import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.beforeAll(ensureHousehold);

test('no Lock control without an adult session', async ({ page }) => {
	await page.goto('/chores');
	await expect(page.getByRole('heading', { level: 1, name: 'Chores' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0);
});

test('Lock ends the adult session and settings ask for the PIN again', async ({ page }) => {
	await signInAsAdult(page, 'e2e-lock-adult');
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	const lock = page.getByRole('button', { name: 'Lock' });
	await expectTappable(lock);

	await lock.click();
	// Optimistic: the control disappears and grown-up screens are left on the tap.
	await expect(lock).toHaveCount(0);
	await expect(page).toHaveURL(/\/$/);

	await page.goto('/settings');
	await expect(page).toHaveURL(/\/unlock\?next=%2Fsettings$/);
	expect((await page.request.get('/api/backups')).status()).toBe(401);
});

test.describe('phone width', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('Lock fits the header without sideways scroll', async ({ page }) => {
		await signInAsAdult(page, 'e2e-lock-phone-adult');
		await page.goto('/chores');
		await page.waitForLoadState('networkidle');
		await expectTappable(page.getByRole('button', { name: 'Lock' }));
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
