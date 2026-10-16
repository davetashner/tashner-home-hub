import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';

interface Seed {
	adultId: string;
	name: string;
	memberId: string;
}

/** Synthetic child with three chores, all done and pending. Leaves the page signed out. */
async function seed(page: Page, label: string): Promise<Seed> {
	const adultId = `adult-ap-${label.replace(/\W/g, '')}`;
	await signInAsAdult(page, adultId);
	const request = page.request;
	const name = `Pip ${Date.now() % 1e9}`;
	const member = await (
		await request.post('/api/members', {
			data: { name, role: 'child', color: 'member-3', avatar: '🐸' }
		})
	).json();
	for (const [title, icon, stars] of [
		['Water plants', '🪴', 2],
		['Set table', '🍽️', 1],
		['Tidy toys', '🧸', 3]
	] as const) {
		const chore = await (
			await request.post('/api/chores', {
				data: { title, icon, stars, memberIds: [member.id], schedule: { type: 'daily' } }
			})
		).json();
		await request.post(`/api/chores/${chore.id}/complete`, { data: { memberId: member.id } });
	}
	await page.context().clearCookies();
	return { adultId, name, memberId: member.id };
}

const card = (page: Page, s: Seed) =>
	page.locator(`[data-testid="child-card"][data-member="${s.memberId}"]`);
const rowFor = (page: Page, s: Seed, title: string) =>
	card(page, s).getByTestId('approval-row').filter({ hasText: title });
const balance = async (page: Page, s: Seed) =>
	(await (await page.request.get(`/api/members/${s.memberId}/stars`)).json()).balance as number;

async function unlockAndOpen(page: Page, s: Seed) {
	await page.goto('/settings/approvals');
	await expect(page).toHaveURL(/\/unlock/);
	await signInAsAdult(page, s.adultId);
	await page.goto('/settings/approvals');
	await expect(card(page, s)).toBeVisible();
}

test('badge shows pending and leads to unlock, then approve makes the star gold', async ({
	page
}, info) => {
	const s = await seed(page, `ok ${info.project.name}`);
	await page.goto('/');
	const badge = page.getByTestId('approvals-badge');
	await expect(badge).toContainText('to check');
	await expectTappable(badge);
	await badge.click();
	await expect(page).toHaveURL(/\/unlock/);
	await signInAsAdult(page, s.adultId);
	await page.goto('/settings/approvals');
	const row = rowFor(page, s, 'Water plants');
	await expect(row).toBeVisible();

	const before = await balance(page, s);
	await expectTappable(row.getByTestId('approve'));
	await expectTappable(row.getByTestId('reject'));
	await row.getByTestId('approve').click();
	await expect(row).toHaveCount(0);
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before + 2} ⭐`);
	expect(await balance(page, s)).toBe(before + 2);
});

test('not yet with a note sends it back without stars', async ({ page }, info) => {
	const s = await seed(page, `no ${info.project.name}`);
	await unlockAndOpen(page, s);
	const before = await balance(page, s);
	await rowFor(page, s, 'Set table').getByTestId('reject').click();
	await expect(page.getByTestId('reject-sheet')).toBeVisible();
	await page.getByTestId('reject-note').fill('Forks go on the left');
	await page.getByTestId('reject-confirm').click();
	await expect(rowFor(page, s, 'Set table')).toHaveCount(0);
	expect(await balance(page, s)).toBe(before);
	await expect(rowFor(page, s, 'Water plants')).toBeVisible();
});

test('approve all, then bonus stars', async ({ page }, info) => {
	const s = await seed(page, `all ${info.project.name}`);
	await unlockAndOpen(page, s);
	const before = await balance(page, s);
	await card(page, s).getByTestId('approve-all').click();
	await expect(card(page, s).getByTestId('approval-row')).toHaveCount(0);
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before + 6} ⭐`);

	await card(page, s).getByTestId('bonus-toggle').click();
	await card(page, s).getByRole('button', { name: 'One more star' }).click();
	await expect(card(page, s).getByTestId('bonus-amount')).toHaveText('2');
	await card(page, s).getByTestId('bonus-give').click();
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before + 8} ⭐`);
});

test('a failed approve puts the row back with a toast', async ({ page }, info) => {
	const s = await seed(page, `fail ${info.project.name}`);
	await unlockAndOpen(page, s);
	await page.route('**/api/completions/*/approve', (route) => route.fulfill({ status: 500 }));
	await rowFor(page, s, 'Tidy toys').getByTestId('approve').click();
	await expect(page.getByTestId('toast')).toBeVisible();
	await expect(rowFor(page, s, 'Tidy toys')).toBeVisible();
});

test('works on a phone', async ({ page }, info) => {
	const s = await seed(page, `phone ${info.project.name}`);
	await page.setViewportSize({ width: 390, height: 844 });
	await unlockAndOpen(page, s);
	const row = rowFor(page, s, 'Tidy toys');
	await expectTappable(row.getByTestId('approve'));
	await expectTappable(row.getByTestId('reject'));
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await row.getByTestId('approve').click();
	await expect(row).toHaveCount(0);
});
