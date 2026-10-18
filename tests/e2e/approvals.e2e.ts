import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';

// Page routes must see every request: a service worker that activates mid-test answers the
// stubbed approve from the real server, so the failure (and its toast) never happens.
test.use({ serviceWorkers: 'block' });

interface Seed {
	adultId: string;
	name: string;
	memberId: string;
}

/** Synthetic child with three chores, all done and pending. Leaves the page signed out. */
async function seed(page: Page, label: string, suffix = ''): Promise<Seed> {
	const adultId = `adult-ap-${label.replace(/\W/g, '')}`;
	await signInAsAdult(page, adultId);
	const request = page.request;
	const name = `Pip ${Date.now() % 1e9}${suffix}`;
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
				data: {
					title,
					icon,
					stars,
					memberIds: [member.id],
					schedule: { type: 'daily' },
					requiresApproval: true
				}
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

test('approve all, then a link opens Settings > Stars with the child preselected', async ({
	page
}, info) => {
	const s = await seed(page, `all ${info.project.name}`);
	await unlockAndOpen(page, s);
	const before = await balance(page, s);
	await card(page, s).getByTestId('approve-all').click();
	await expect(card(page, s).getByTestId('approval-row')).toHaveCount(0);
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before + 6} ⭐`);

	const link = card(page, s).getByTestId('stars-link');
	await expectTappable(link);
	await link.click();
	await expect(page).toHaveURL(/\/settings\/stars\?member=/);
	await expect(
		page.locator(`[data-testid="stars-member"][data-member="${s.memberId}"]`)
	).toHaveAttribute('aria-pressed', 'true');
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

test('phone shell: compact header, nav clear of content, long names truncate', async ({
	page
}, info) => {
	const s = await seed(page, `shell ${info.project.name}`, ' Wigglesworth-Featherstone');
	await page.setViewportSize({ width: 390, height: 844 });
	await unlockAndOpen(page, s);

	const header = page.locator('header').first();
	expect((await header.boundingBox())!.height).toBeLessThanOrEqual(88);

	const name = card(page, s).locator('h2');
	await expect(name).toContainText('Featherstone');
	expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
	expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');

	const main = page.locator('main');
	await main.evaluate((el) => (el.scrollTop = el.scrollHeight));
	const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
	const mainBox = (await main.boundingBox())!;
	expect(mainBox.y + mainBox.height).toBeLessThanOrEqual(nav.y + 1);
	const last = (await card(page, s).getByTestId('stars-link').boundingBox())!;
	expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('a grown-up can undo an approved chore any time later', async ({ page }, info) => {
	const s = await seed(page, `undo ${info.project.name}`);
	await unlockAndOpen(page, s);
	const before = await balance(page, s);
	await rowFor(page, s, 'Water plants').getByTestId('approve').click();
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before + 2} ⭐`);
	await page.reload(); // the list comes from the server, not just this page's memory
	const done = card(page, s).getByTestId('done-row').filter({ hasText: 'Water plants' });
	await expect(done).toBeVisible();
	const undo = done.getByTestId('undo-done');
	await expectTappable(undo);
	await undo.click();
	await expect(done).toHaveCount(0);
	await expect(card(page, s).getByTestId(`balance-${s.memberId}`)).toHaveText(`${before} ⭐`);
	await expect(page.getByTestId('toast')).toContainText('Undone');
	expect(await balance(page, s)).toBe(before);
	await expect(rowFor(page, s, 'Set table')).toBeVisible(); // pending ones are untouched
});
