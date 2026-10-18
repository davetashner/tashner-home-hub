import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';

test('create, edit and archive a weekday chore', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-chores-${info.project.name}`);
	// Unique per run, not just per project: projects and repeats share one database, and a kid or
	// chore left over with the same name would make the locators below match several rows.
	const stamp = `${info.project.name} ${Date.now() % 1e9}`;
	const title = `Chore ${stamp}`;
	const made = await page.request.post('/api/members', {
		data: { name: `Kid ${stamp}`, role: 'child', color: 'member-3' }
	});
	expect(made.ok()).toBe(true);
	const kid = (await made.json()) as { id: string; name: string };
	trackMember(kid.id);

	await gotoHydrated(page, '/settings/chores');
	const add = page.getByRole('button', { name: 'Add Star Job' });
	await expectTappable(add);
	const form = page.getByTestId('chore-form');
	await add.click();
	await expect(form).toBeVisible();
	await form.getByLabel('Star Job', { exact: true }).fill(title);
	await form.locator('label:has(input[name="icon"][value="🦷"]) span').click();
	await form.getByRole('button', { name: 'More stars' }).click();
	await expect(form.getByLabel('Star count')).toHaveText('2');
	await form.locator('label', { hasText: kid.name }).click();
	await form.getByText('Morning', { exact: true }).click();
	await form.getByText('Certain days', { exact: true }).click();
	await form.getByText('Mon', { exact: true }).click();
	await form.getByText('Wed', { exact: true }).click();

	for (const control of [
		form.getByRole('button', { name: 'More stars' }),
		form.getByRole('button', { name: 'Fewer stars' }),
		form.locator('label', { hasText: kid.name }),
		form.getByText('Morning', { exact: true }),
		form.getByText('Certain days', { exact: true }),
		form.getByText('Mon', { exact: true }),
		form.getByRole('button', { name: 'Save' })
	]) {
		await expectTappable(control);
	}
	await form.getByRole('button', { name: 'Save' }).click();

	const row = page.getByRole('listitem').filter({ hasText: title });
	await expect(row).toBeVisible();
	await expect(row.getByText('Mon, Wed')).toBeVisible();
	await expect(row.getByText('2 stars')).toBeVisible();
	await expectTappable(row.getByRole('button', { name: `Edit ${title}` }));

	await row.getByRole('button', { name: `Archive ${title}` }).click();
	await page.getByRole('button', { name: 'Yes, archive' }).click();
	await expect(page.getByText(title)).toHaveCount(0);
});
