import { expect, test } from '@playwright/test';
import { seedKid } from './kid';
import { PIN } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';

test('a kid with a routine but no chores shows in the switcher and can open the routine @J2.1', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routine-only-${info.project.name}`);
	const name = `Routine Only ${Date.now() % 1e9}`;
	const kidRes = await page.request.post('/api/members', {
		data: { name, role: 'child', color: 'member-5', avatar: '🦉' }
	});
	expect(kidRes.status()).toBe(201);
	const kid = (await kidRes.json()) as { id: string };
	trackMember(kid.id);
	let routineId: string | null = null;
	try {
		const made = await page.request.post('/api/routines', {
			data: {
				memberId: kid.id,
				name: `Wind down ${Date.now() % 1e9}`,
				steps: [{ label: 'Brush teeth', icon: 'toothbrush' }]
			}
		});
		expect(made.status()).toBe(201);
		routineId = ((await made.json()) as { id: string }).id;
		await page.context().clearCookies(); // the kid screen needs no adult session

		await gotoHydrated(page, `/chores?member=${kid.id}`);
		await expect(page.getByTestId('child-switcher').getByRole('button', { name })).toBeVisible();
		await expect(page.getByTestId('child-switcher').locator('button')).not.toHaveCount(1);
		// A routine counts as one habit (hub-esf): no Star Jobs, one habit to do.
		await expect(page.getByTestId('star-jobs')).toContainText('No Star Jobs today.');
		await expect(page.getByTestId('habits-count')).toHaveText('0/1');
		await page.getByTestId('routine-button').first().click();
		await expect(page.getByTestId('routine-player')).toBeVisible();
		expect(seed.memberId).not.toBe(kid.id);
	} finally {
		if (routineId) {
			await page.context().clearCookies();
			await page.request.post('/api/auth/pin', {
				data: {
					memberId: `adult-cel-${`routine-only-${info.project.name}`.replace(/\W/g, '')}`,
					pin: PIN,
					remember: true
				}
			});
			const del = await page.request.delete(`/api/routines/${routineId}`, { data: {} });
			expect(del.ok()).toBe(true);
		}
	}
});
