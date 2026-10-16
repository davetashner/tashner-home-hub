import { expect, test, type Locator } from '@playwright/test';
import { signInAsAdult } from './adult';

async function expectTappable(locator: Locator) {
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBeGreaterThanOrEqual(60);
	expect(box!.height).toBeGreaterThanOrEqual(60);
}

test('create, edit and archive a weekday chore', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-chores-${info.project.name}`);
	// Unique per project so the two orientations never collide on the shared database.
	const title = `Chore ${info.project.name}`;
	const made = await page.request.post('/api/members', {
		data: { name: `Kid ${info.project.name}`, role: 'child', color: 'member-3' }
	});
	expect(made.ok()).toBe(true);
	const kid = (await made.json()) as { name: string };

	await page.goto('/settings/chores');
	const add = page.getByRole('button', { name: 'Add chore' });
	await expectTappable(add);
	await add.click();

	const form = page.getByTestId('chore-form');
	await form.getByLabel('Chore', { exact: true }).fill(title);
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
