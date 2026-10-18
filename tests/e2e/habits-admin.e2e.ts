import { expect, test } from '@playwright/test';
import { expectTappable } from './tap';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';

test('a grown-up adds a daily habit: no stars, no approval, kept apart from chores', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-habits-${info.project.name}`);
	const stamp = `${info.project.name} ${Date.now() % 1e9}`;
	const title = `Habit ${stamp}`;
	const made = await page.request.post('/api/members', {
		data: { name: `Kid ${stamp}`, role: 'child', color: 'member-4' }
	});
	expect(made.ok()).toBe(true);
	const kid = (await made.json()) as { id: string; name: string };
	trackMember(kid.id);

	await gotoHydrated(page, '/settings/habits');
	const add = page.getByRole('button', { name: 'Add habit' });
	await expectTappable(add);
	const form = page.getByTestId('chore-form');
	await add.click();
	await expect(form).toBeVisible();
	await expect(form.getByRole('button', { name: 'More stars' })).toHaveCount(0);
	await expect(form.getByText('A grown-up checks it before stars count')).toHaveCount(0);
	await form.getByLabel('Habit', { exact: true }).fill(title);
	await form.locator('label:has(input[name="icon"][value="🐟"]) span').click();
	await form.locator('label', { hasText: kid.name }).click();
	await form.getByRole('button', { name: 'Save' }).click();

	const row = page.getByRole('listitem').filter({ hasText: title });
	await expect(row).toBeVisible();
	await expect(row.getByText('Every day · anytime · no stars')).toBeVisible();

	await gotoHydrated(page, '/settings/chores');
	await expect(page.getByTestId('chore-list')).toBeVisible();
	await expect(page.getByText(title)).toHaveCount(0);

	await gotoHydrated(page, '/settings/habits');
	await row.getByRole('button', { name: `Archive ${title}` }).click();
	await page.getByRole('button', { name: 'Yes, archive' }).click();
	await expect(page.getByText(title)).toHaveCount(0);
});
