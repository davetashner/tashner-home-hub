import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { expectTappable } from './tap';

test('Star Jobs and habits each count, and finishing every habit earns a star', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-habits-${info.project.name.replace(/\W/g, '')}`);
	const request = page.request;
	const member = (await (
		await request.post('/api/members', {
			data: { name: `Kiki ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json()) as { id: string };
	trackMember(member.id);
	const add = (data: object) =>
		request.post('/api/chores', {
			data: { memberIds: [member.id], schedule: { type: 'daily' }, ...data }
		});
	expect((await add({ title: 'Wash the window', icon: '🪟', stars: 2 })).ok()).toBe(true);
	expect((await add({ title: 'Hang up towels', icon: '🧺', kind: 'habit' })).ok()).toBe(true);
	expect((await add({ title: 'Feed the fish', icon: '🐟', kind: 'habit' })).ok()).toBe(true);
	await page.context().clearCookies(); // the kid screen needs no adult session

	await page.goto(`/chores?member=${member.id}`);
	const jobs = page.getByTestId('star-jobs');
	const habits = page.getByTestId('habits');
	await expect(page.getByTestId('star-jobs-count')).toHaveText('0/1');
	await expect(page.getByTestId('habits-count')).toHaveText('0/2');
	await expect(jobs.getByText('Wash the window')).toBeVisible();
	await expect(habits.getByTestId('habit-tag')).toHaveCount(2);
	await expect(page.getByTestId('habit-week')).toContainText('Do them all today for a star');

	const card = (title: string) => habits.getByTestId('chore-card').filter({ hasText: title });
	const didIt = card('Hang up towels').getByTestId('did-it');
	await expectTappable(didIt);
	// A tap before the page hydrates is lost: retry until it counts.
	await expect(async () => {
		await didIt.click();
		await expect(page.getByTestId('habits-count')).toHaveText('1/2', { timeout: 1000 });
	}).toPass();
	// Habits are plain checks: done at once, no grown-up needed.
	await expect(card('Hang up towels').getByTestId('done')).toBeVisible();

	await card('Feed the fish').getByTestId('did-it').click();
	await expect(page.getByTestId('habits-count')).toHaveText('2/2');
	await expect(page.getByTestId('habit-week')).toContainText('you earned a star');
	await expect(page.getByTestId('habit-week')).toContainText(/This week \d+ of \d+/);
	await expect(page.getByTestId('star-jobs-count')).toHaveText('0/1');

	const stars = (await (await request.get(`/api/members/${member.id}/stars`)).json()) as {
		balance: number;
	};
	expect(stars.balance).toBe(1);
});
