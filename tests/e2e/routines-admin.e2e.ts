import { expect, test } from '@playwright/test';
import { seedKid } from './kid';

test('an adult creates, edits, reorders and deletes a routine; the kid sees it', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routines-admin-${info.project.name}`);
	const routineName = `Morning ${Date.now() % 1e9}-${info.project.name}`;
	const kid = (await (await page.request.get('/api/members')).json()).find(
		(m: { id: string }) => m.id === seed.memberId
	);

	await page.goto('/settings/routines');
	await expect(async () => {
		await page.getByTestId('add-routine').click();
		await expect(page.getByTestId('routine-form')).toBeVisible();
	}).toPass();
	await page.getByTestId('routine-member').selectOption(seed.memberId);
	await page.getByTestId('routine-name').fill(routineName);
	// The step rows are labelled as steps, for this kid, with no example text that reads as a field.
	const stepList = page.getByRole('list', { name: 'Steps' });
	await expect(stepList).toHaveAccessibleDescription(new RegExp(`^What ${kid.name} ticks off`));
	await expect(page.getByLabel('Step 1 name')).toHaveAttribute('placeholder', 'Step 1');
	await page.getByLabel('Step 1 name').fill('Brush teeth');
	await page.getByTestId('add-step').click();
	await page.getByLabel('Step 2 name').fill('Get dresed');
	await page.getByLabel(/^Picture for step 2/).click();
	await page.getByTestId('icon-picker').getByRole('radio', { name: 'Get dressed' }).click();
	await page.getByTestId('add-step').click();
	await page.getByLabel('Step 3 name').fill('Shoes on');
	await page.getByLabel(/^Picture for step 3/).click();
	const target = await page
		.getByTestId('icon-picker')
		.getByRole('radio', { name: 'Shoes on' })
		.boundingBox();
	expect(target!.width).toBeGreaterThanOrEqual(60);
	expect(target!.height).toBeGreaterThanOrEqual(60);
	await page.getByTestId('icon-picker').getByRole('radio', { name: 'Shoes on' }).click();
	const created = page.waitForResponse(
		(r) => r.url().endsWith('/api/routines') && r.request().method() === 'POST'
	);
	await page.getByTestId('routine-save').click();
	expect((await created).status()).toBe(201);
	const row = page.getByTestId('routine-row').filter({ hasText: routineName });
	await expect(row).toContainText('Brush teeth → Get dresed → Shoes on');
	await expect(page.getByRole('heading', { name: kid.name })).toBeVisible();

	// Edit: fix the typo, then move "Shoes on" to the top.
	await row.getByRole('button', { name: `Edit ${routineName}` }).click();
	await page.getByLabel('Step 2 name').fill('Get dressed');
	await page.getByRole('button', { name: 'Move step 3 up' }).click();
	await page.getByRole('button', { name: 'Move step 2 up' }).click();
	await expect(page.getByLabel('Step 1 name')).toHaveValue('Shoes on');
	const patched = page.waitForResponse(
		(r) => r.url().includes('/api/routines/') && r.request().method() === 'PATCH'
	);
	await page.getByTestId('routine-save').click();
	expect((await patched).status()).toBe(200);
	await expect(row).toContainText('Shoes on → Brush teeth → Get dressed');

	// Kid view (no adult session) shows the routine button.
	const kidPage = await page.context().browser()!.newContext({ baseURL: info.project.use.baseURL });
	const kp = await kidPage.newPage();
	await kp.goto(`/chores?member=${seed.memberId}`);
	await expect(async () => {
		await expect(kp.getByTestId('routine-button').filter({ hasText: routineName })).toBeVisible();
	}).toPass();
	await kidPage.close();

	// Delete with the in-page confirm.
	await row.getByRole('button', { name: `Delete ${routineName}` }).click();
	await expect(row).toContainText(`Delete ${routineName}?`);
	const deleted = page.waitForResponse(
		(r) => r.url().includes('/api/routines/') && r.request().method() === 'DELETE'
	);
	await row.getByTestId('routine-delete-yes').click();
	expect((await deleted).status()).toBe(200);
	await expect(row).toHaveCount(0);
});
