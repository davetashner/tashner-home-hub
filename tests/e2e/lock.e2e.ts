import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

test.beforeAll(ensureHousehold);

test('no Lock control without an adult session', async ({ page }) => {
	await gotoHydrated(page, '/chores');
	await expect(page.getByRole('heading', { level: 1, name: 'To-Dos' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0);
});

test('Lock ends the adult session and settings ask for the PIN again', async ({ page }) => {
	await signInAsAdult(page, 'e2e-lock-adult');
	await gotoHydrated(page, '/settings');
	await page.waitForLoadState('networkidle');
	const lock = page.getByRole('button', { name: 'Lock' });
	await expectTappable(lock);

	const loggedOut = page.waitForResponse('**/api/auth/logout');
	await lock.click();
	// Optimistic: the control disappears and grown-up screens are left on the tap.
	await expect(lock).toHaveCount(0);
	await expect(page).toHaveURL(/\/$/);
	expect((await loggedOut).ok()).toBe(true);

	await gotoHydrated(page, '/settings');
	await expect(page).toHaveURL(/\/unlock\?next=%2Fsettings$/);
	expect((await page.request.get('/api/backups')).status()).toBe(401);
});

test.describe('phone width', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('Lock fits the header without sideways scroll', async ({ page }) => {
		await signInAsAdult(page, 'e2e-lock-phone-adult');
		await gotoHydrated(page, '/chores');
		await page.waitForLoadState('networkidle');
		await expectTappable(page.getByRole('button', { name: 'Lock' }));
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});

test('Lock revokes a copied session cookie', async ({ page, browser, baseURL }) => {
	await signInAsAdult(page, 'e2e-revoke-adult');
	const stolen = (await page.context().cookies()).filter((c) => c.name === 'hub_session');
	expect(stolen).toHaveLength(1);

	const other = await browser.newContext({ baseURL });
	await other.addCookies(stolen);
	expect((await other.request.get('/api/backups')).status()).toBe(200);

	await gotoHydrated(page, '/settings');
	await page.waitForLoadState('networkidle');
	const loggedOut = page.waitForResponse('**/api/auth/logout');
	await page.getByRole('button', { name: 'Lock' }).click();
	expect((await loggedOut).ok()).toBe(true);

	expect((await other.request.get('/api/backups')).status()).toBe(401);
	await other.close();
});
