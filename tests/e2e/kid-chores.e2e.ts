import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';

interface Seed {
	name: string;
	memberId: string;
	chores: Record<string, string>;
}

/** Synthetic kid with three chores; "Make bed" (2 stars) is already approved. */
async function seed(page: Page, label: string): Promise<Seed> {
	const id = `adult-kc-${label.replace(/\W/g, '')}`;
	await signInAsAdult(page, id);
	const request = page.request;
	const name = `Kiki ${Date.now() % 1e9}`;
	const member = await (
		await request.post('/api/members', {
			data: { name, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();
	const chores: Record<string, string> = {};
	const defs = [
		{ title: 'Make bed', icon: '🛏️', stars: 2, timeOfDay: 'morning' },
		{ title: 'Brush teeth', icon: '🪥', stars: 1, timeOfDay: 'morning' },
		{ title: 'Feed the fish', icon: '🐟', stars: 1, timeOfDay: 'afternoon' }
	];
	for (const def of defs) {
		const chore = await (
			await request.post('/api/chores', {
				data: { ...def, memberIds: [member.id], schedule: { type: 'daily' } }
			})
		).json();
		chores[def.title] = chore.id;
	}
	const done = await (
		await request.post(`/api/chores/${chores['Make bed']}/complete`, {
			data: { memberId: member.id }
		})
	).json();
	await request.post(`/api/completions/${done.completion.id}/approve`, { data: {} });
	await page.context().clearCookies(); // the kid screen needs no adult session
	return { name, memberId: member.id, chores };
}

async function open(page: Page, s: Seed) {
	await page.goto(`/chores?member=${s.memberId}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Brush teeth' })).toBeVisible();
}

const card = (page: Page, title: string) =>
	page.getByTestId('chore-card').filter({ has: page.getByRole('heading', { name: title }) });

test('tap shows pending instantly, even while the network is slow; undo restores', async ({
	page
}, info) => {
	const s = await seed(page, `tap ${info.project.name}`);
	await page.route('**/api/chores/*/complete', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	await open(page, s);
	await expect(page.getByRole('heading', { name: /This morning/ })).toBeVisible();
	const teeth = card(page, 'Brush teeth');
	const button = teeth.getByTestId('did-it');
	await expectTappable(button, 96);
	await expect(page.getByTestId('jar-counts')).toContainText('2 gold stars, 0 waiting');
	await button.click();
	await expect(teeth).toHaveAttribute('data-status', 'pending', { timeout: 500 });
	await expect(page.getByTestId('jar-counts')).toContainText('2 gold stars, 1 waiting');
	const undo = teeth.getByTestId('undo');
	await expect(teeth.getByTestId('undo-seconds')).toHaveText(/^(10|9)$/);
	await expect(() => expectTappable(undo, 96)).toPass(); // settles after the pop-in
	const undone = page.waitForResponse((r) => r.url().includes('/undo'));
	await undo.click();
	await expect(teeth.getByTestId('did-it')).toBeVisible();
	await expect(page.getByTestId('jar-counts')).toContainText('2 gold stars, 0 waiting');
	expect((await undone).ok()).toBe(true);
	await open(page, s);
	await expect(card(page, 'Brush teeth')).toHaveAttribute('data-status', 'undone');
});

test('a tap the server refuses reverts with a gentle message', async ({ page }, info) => {
	const s = await seed(page, `fail ${info.project.name}`);
	await open(page, s);
	await page.route('**/api/chores/*/complete', async (route) => {
		await new Promise((r) => setTimeout(r, 800));
		await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	const fish = card(page, 'Feed the fish');
	await fish.getByTestId('did-it').click();
	await expect(fish).toHaveAttribute('data-status', 'pending', { timeout: 500 });
	await expect(page.getByTestId('gentle-message')).toContainText('did not save');
	await expect(fish).toHaveAttribute('data-status', 'none');
});

for (const theme of ['day', 'night']) {
	test(`no serious accessibility problems (${theme})`, async ({ page }, info) => {
		const s = await seed(page, `axe ${theme} ${info.project.name}`);
		await page.goto(`/chores?member=${s.memberId}`);
		await card(page, 'Feed the fish').getByTestId('did-it').click();
		await expect(card(page, 'Feed the fish').getByTestId('waiting')).toBeVisible();
		if (theme === 'night')
			await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
		const { violations } = await new AxeBuilder({ page }).analyze();
		expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
	});
}
