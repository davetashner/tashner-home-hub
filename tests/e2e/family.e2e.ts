import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';

test('add and edit a family member with tappable controls', async ({ page }, info) => {
	// Unique per project so the two orientations never collide on the shared database.
	const name = `Test ${info.project.name}`;
	await signInAsAdult(page, `e2e-family-${info.project.name}`);
	await gotoHydrated(page, '/settings/family');

	const add = page.getByRole('button', { name: 'Add person' });
	await expectTappable(add);
	await add.click();

	const form = page.getByTestId('member-form');
	await form.getByLabel('Name').fill(name);
	await form.getByText('Kid', { exact: true }).click();
	await form.locator('label:has(input[aria-label="Color 3"]) span').click();
	await form.locator('label:has(input[name="avatar"][value="🦊"]) span').click();
	for (const control of [
		form.getByText('Kid', { exact: true }),
		form.locator('label:has(input[aria-label="Color 3"]) span'),
		form.locator('label:has(input[name="avatar"][value="🦊"]) span'),
		form.getByRole('button', { name: 'Save' }),
		form.getByRole('button', { name: 'Cancel' })
	]) {
		await expectTappable(control);
	}
	await page.screenshot({
		path: `${process.env.SHOTS ?? 'test-results'}/${info.project.name}.png`
	});
	await form.getByRole('button', { name: 'Save' }).click();

	const row = page.getByRole('listitem').filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(row.getByText('Kid', { exact: true })).toBeVisible();
	await expectTappable(row.getByRole('button', { name: 'Edit' }));

	await row.getByRole('button', { name: 'Edit' }).click();
	const edit = page.getByTestId('member-form');
	await edit.getByLabel('Name').fill(`${name} Edited`);
	await edit.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: `${name} Edited` })).toBeVisible();

	// Clean up through the confirm flow.
	await page
		.getByRole('listitem')
		.filter({ hasText: `${name} Edited` })
		.getByRole('button', { name: 'Delete' })
		.click();
	await page.getByRole('button', { name: 'Yes, delete' }).click();
	await expect(page.getByText(`${name} Edited`)).toHaveCount(0);
});

test('a 502 with an empty body says the hub is unreachable', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-family-502-${info.project.name}`);
	await gotoHydrated(page, '/settings/family');
	await page.route('**/api/members', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 502, body: '' })
			: route.fallback()
	);

	await page.getByRole('button', { name: 'Add person' }).click();
	const form = page.getByTestId('member-form');
	await form.getByLabel('Name').fill('Unreachable');
	await form.getByRole('button', { name: 'Save' }).click();

	await expect(form.getByText("Couldn't reach the hub. Try again in a moment.")).toBeVisible();
});
