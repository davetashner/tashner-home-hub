import { expect, test } from '@playwright/test';
import { signInAsAdult } from './adult';
import { gotoHydrated } from './hydrated';
import { trackMember } from './cleanup';

// hub-kko.6: every child is on the kid screen, even with no chores today, so they can still reach
// their jar, goals, Shop and Log reading. Kids are named per project: both wall projects share one
// database and run in parallel.
test('a kid with no chores still appears, with their own "All free" state and Log reading @J1.16', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-kv-${info.project.name.replace(/\W/g, '')}`);
	const tag = `${info.project.name.includes('portrait') ? 'P' : 'L'}${Date.now() % 1e6}`;
	const mk = async (name: string) => {
		const m = await (
			await page.request.post('/api/members', {
				data: { name, role: 'child', color: 'member-4', avatar: '🦊' }
			})
		).json();
		trackMember(m.id);
		return m.id as string;
	};
	const busy = await mk(`Busy ${tag}`);
	const free = await mk(`Free ${tag}`);
	await page.request.post('/api/chores', {
		data: {
			title: `Sweep ${tag}`,
			icon: '🧹',
			stars: 1,
			timeOfDay: 'morning',
			memberIds: [busy],
			schedule: { type: 'daily' },
			requiresApproval: true
		}
	});
	await page.context().clearCookies();

	await gotoHydrated(page, `/chores?member=${busy}`);
	await expect(page.getByRole('heading', { name: `Sweep ${tag}` })).toBeVisible();
	const switcher = page.getByTestId('child-switcher');
	await expect(switcher.getByRole('button', { name: `Busy ${tag}` })).toBeVisible();
	await switcher.getByRole('button', { name: `Free ${tag}` }).click();
	await expect(switcher.getByRole('button', { name: `Free ${tag}`, pressed: true })).toBeVisible();
	await expect(page.getByTestId('all-free')).toBeVisible();
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await expect(page.getByTestId('practice-open')).toBeVisible();

	// Opening the screen on the kid with nothing selects them too (?member=).
	await gotoHydrated(page, `/chores?member=${free}`);
	await expect(page.getByTestId('all-free')).toBeVisible();
	await expect(page.getByTestId('practice-open')).toBeVisible();
});
