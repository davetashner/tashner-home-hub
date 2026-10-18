import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

/** Two synthetic kids sharing one chore ("Tidy toys"); each also has a chore of their own. */
async function seedTwo(page: Page, project: string) {
	await signInAsAdult(page, `adult-sw-${project.replace(/\W/g, '')}`);
	const stamp = `${Date.now() % 1e9}`;
	const make = async (name: string, color: string, avatar: string) =>
		(
			await page.request.post('/api/members', {
				data: { name: `${name} ${stamp}`, role: 'child', color, avatar }
			})
		).json() as Promise<{ id: string; name: string }>;
	const a = await make('Pip', 'member-3', '🐸');
	const b = await make('Moss', 'member-5', '🦉');
	const chore = (title: string, icon: string, memberIds: string[]) =>
		page.request.post('/api/chores', {
			data: {
				title,
				icon,
				stars: 1,
				memberIds,
				schedule: { type: 'daily' },
				requiresApproval: true
			}
		});
	await chore('Tidy toys', '🧸', [a.id, b.id]);
	await chore('Water plants', '🪴', [a.id]);
	await chore('Set the table', '🍽️', [b.id]);
	await page.context().clearCookies(); // the kid screen needs no adult session
	return { a, b };
}

const card = (page: Page, title: string) =>
	page.getByTestId('chore-card').filter({ has: page.getByRole('heading', { name: title }) });

test('the avatar switcher swaps kids instantly and keeps each child’s undo', async ({
	page
}, info) => {
	const { a, b } = await seedTwo(page, info.project.name);
	await gotoHydrated(page, `/chores?member=${a.id}`);
	await expect(page.getByRole('heading', { name: 'Water plants' })).toBeVisible();

	const switcher = page.getByTestId('child-switcher');
	const pipButton = switcher.getByRole('button', { name: a.name, exact: true });
	const mossButton = switcher.getByRole('button', { name: b.name, exact: true });
	await expect(pipButton).toHaveAttribute('aria-pressed', 'true');
	await expectTappable(mossButton, 96);

	// Pip taps the shared chore: the undo countdown is Pip's alone.
	await card(page, 'Tidy toys').getByTestId('did-it').click();
	await expect(card(page, 'Tidy toys').getByTestId('undo')).toBeVisible();

	// The network stalls: switching must not wait for it.
	await page.route('**/api/**', async (route) => {
		await new Promise((r) => setTimeout(r, 3000));
		await route.continue();
	});
	await mossButton.click();
	await expect(page.getByText(`Hi, ${b.name}!`)).toBeVisible({ timeout: 500 });
	await expect(page.getByRole('heading', { name: 'Set the table' })).toBeVisible({ timeout: 500 });
	await expect(page).toHaveURL(new RegExp(`member=${b.id}`));
	await expect(mossButton).toHaveAttribute('aria-pressed', 'true');
	await expect(card(page, 'Tidy toys')).toHaveAttribute('data-status', 'none');
	await expect(card(page, 'Tidy toys').getByTestId('undo')).toHaveCount(0);
	await page.unroute('**/api/**');

	await pipButton.click();
	await expect(page).toHaveURL(new RegExp(`member=${a.id}`));
	await expect(card(page, 'Tidy toys')).toHaveAttribute('data-status', 'pending');
	await expect(card(page, 'Tidy toys').getByTestId('undo')).toBeVisible();

	// The page has no horizontal scroll with the switcher in place.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	await reloadHydrated(page);
	await expect(page.getByText(`Hi, ${a.name}!`)).toBeVisible();
});
