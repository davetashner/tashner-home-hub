import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { gotoHydrated, reloadHydrated } from './hydrated';
import { holdLock } from './file-lock';

test.beforeAll(ensureHousehold);
// The shared server's saved background choice stays Auto: this spec never changes it.

// Birthday dates are household-wide, so projects take turns. Synthetic dates only.
test('a grown-up adds a birthday, sees it saved, then removes it @J9.6', async ({ page }, info) => {
	test.setTimeout(120_000);
	const release = await holdLock('birthdays');
	try {
		await signInAsAdult(page, `e2e-birthdays-${info.project.name.replace(/\W/g, '')}`);
		// Start clean in case an earlier failed run left a date behind.
		expect(
			(await page.request.put('/api/settings/birthdays', { data: { birthdays: [] } })).ok()
		).toBe(true);
		await gotoHydrated(page, '/settings/background');
		const list = page.getByTestId('birthday-list');
		await expect(list).toContainText('No birthdays yet.');

		const add = page.getByRole('group', { name: 'Add a birthday' });
		await add.getByLabel('Month').selectOption('3');
		await add.getByLabel('Day').selectOption('14');
		await add.getByLabel('Name (optional, shown only here)').fill('Kid A');
		await add.getByRole('button', { name: 'Add' }).click();
		await expect(list.getByTestId('birthday-item')).toHaveText(/March\s+14 · Kid A/);

		// Saved: a reload and the API both agree.
		await reloadHydrated(page);
		await expect(list.getByTestId('birthday-item')).toHaveText(/March\s+14 · Kid A/);
		const saved = await (await page.request.get('/api/settings/birthdays')).json();
		expect(saved).toEqual({ birthdays: [{ month: 3, day: 14, label: 'Kid A' }] });

		await list.getByRole('button', { name: 'Remove March 14' }).click();
		await expect(list).toContainText('No birthdays yet.');
		await reloadHydrated(page);
		await expect(list).toContainText('No birthdays yet.');
		expect(await (await page.request.get('/api/settings/birthdays')).json()).toEqual({
			birthdays: []
		});
	} finally {
		await page.request.put('/api/settings/birthdays', { data: { birthdays: [] } }).catch(() => {});
		release();
	}
});
