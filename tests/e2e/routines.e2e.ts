import { expect, test } from '@playwright/test';
import { seedKid, stubAudio } from './kid';
import { expectTappable } from './tap';

test('the kid steps through a routine, a reload resumes, and it celebrates at the end', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routine-${info.project.name}`);
	const notes = await stubAudio(page);
	const made = await page.request.post('/api/routines', {
		data: {
			memberId: seed.memberId,
			name: 'Morning',
			steps: [
				{ label: 'Brush teeth', icon: 'toothbrush' },
				{ label: 'Get dressed', icon: 'shirt' },
				{ label: 'Shoes on', icon: 'shoes' }
			]
		}
	});
	expect(made.status()).toBe(201);
	await page.context().clearCookies(); // the kid screen needs no adult session

	const open = async () => {
		await page.goto(`/chores?member=${seed.memberId}`);
		await expect(async () => {
			await page.getByTestId('routine-button').filter({ hasText: 'Morning' }).click();
			await expect(page.getByTestId('routine-player')).toBeVisible();
		}).toPass();
	};
	await open();
	await expect(page.getByTestId('routine-step')).toContainText('Brush teeth');
	await expectTappable(page.getByTestId('routine-done'), 96);

	const saved = page.waitForResponse(
		(r) => r.url().includes('/progress') && r.request().method() === 'POST'
	);
	await page.getByTestId('routine-done').click();
	expect((await saved).status()).toBe(200);
	await expect(page.getByTestId('routine-step')).toContainText('Get dressed');
	await expect(page.getByTestId('routine-progress').locator('[data-state="done"]')).toHaveCount(1);

	// Reload mid-routine: today's progress is kept.
	await open();
	await expect(page.getByTestId('routine-step')).toContainText('Get dressed');

	await page.getByTestId('routine-done').click();
	await expect(page.getByTestId('routine-step')).toContainText('Shoes on');
	await page.getByTestId('routine-done').click();
	await expect(page.getByTestId('routine-complete')).toBeVisible();
	await expect.poll(notes).toBeGreaterThan(0);

	// Finished for today: the button is gone.
	await page.getByTestId('routine-close').click();
	await expect(page.getByTestId('routine-player')).toHaveCount(0);
	await expect(page.getByTestId('routine-button')).toHaveCount(0);
});
