import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.beforeAll(ensureHousehold);

async function sessionCookie(page: Page) {
	return (await page.context().cookies()).find((c) => c.name === 'hub_session');
}

async function lockFlow(page: Page, trigger: 'header' | 'settings') {
	await signInAsAdult(page, 'e2e-lock-adult');
	expect(await sessionCookie(page)).toBeDefined();
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('signed-in-as')).toHaveText('Signed in as Test Adult');
	const chip = page.getByTestId('lock-chip');
	const row = page.getByTestId('lock-row');
	await expectTappable(chip);
	await expectTappable(row);
	await (trigger === 'header' ? chip : row).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('toast')).toHaveText('Locked');
	await expect(page.getByTestId('lock-chip')).toHaveCount(0);
	expect(await sessionCookie(page)).toBeUndefined();
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/unlock\?next=%2Fsettings$/);
}

test('header lock signs out, toasts, and re-locks settings', async ({ page }) => {
	await lockFlow(page, 'header');
});

test('settings lock button signs out too', async ({ page }) => {
	await lockFlow(page, 'settings');
});

test('lock control is hidden when nobody is signed in', async ({ page }) => {
	await page.goto('/chores');
	await expect(page.getByTestId('lock-chip')).toHaveCount(0);
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test('lock works on a phone and stays compact', async ({ page }) => {
		await lockFlow(page, 'header');
	});
});
