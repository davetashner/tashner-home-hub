import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';
import { trackMember } from './cleanup';

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
	trackMember(member.id);
	const chores: Record<string, string> = {};
	const defs = [
		{ title: 'Make bed', icon: '🛏️', stars: 2, timeOfDay: 'morning' },
		{ title: 'Brush teeth', icon: '🪥', stars: 1, timeOfDay: 'morning' },
		{ title: 'Feed the fish', icon: '🐟', stars: 1, timeOfDay: 'afternoon' }
	];
	for (const def of defs) {
		const chore = await (
			await request.post('/api/chores', {
				data: {
					...def,
					memberIds: [member.id],
					schedule: { type: 'daily' },
					requiresApproval: true
				}
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
	await gotoHydrated(page, `/chores?member=${s.memberId}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Brush teeth' })).toBeVisible();
}

const card = (page: Page, title: string) =>
	page.getByTestId('chore-card').filter({ has: page.getByRole('heading', { name: title }) });

test('tap shows pending instantly, even while the network is slow; undo restores @J1.2', async ({
	page
}, info) => {
	const s = await seed(page, `tap ${info.project.name}`);
	await page.route('**/api/chores/*/complete', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	await open(page, s);
	await expect(page.getByRole('heading', { name: /Morning/ })).toBeVisible();
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

test('a tap the server refuses reverts with a gentle message @J1.5', async ({ page }, info) => {
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
	test(`no serious accessibility problems (${theme}) @J16.4`, async ({ page }, info) => {
		const s = await seed(page, `axe ${theme} ${info.project.name}`);
		await gotoHydrated(page, `/chores?member=${s.memberId}`);
		await card(page, 'Feed the fish').getByTestId('did-it').click();
		await expect(card(page, 'Feed the fish').getByTestId('waiting')).toBeVisible();
		if (theme === 'night')
			await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
		const { violations } = await new AxeBuilder({ page }).analyze();
		expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
	});
}

test('a chore without approval can be undone in its 10 seconds, taking the gold star back @J1.4', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-kc-noappr${info.project.name.replace(/\W/g, '')}`);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Nori ${Date.now() % 1e9}`, role: 'child', color: 'member-2', avatar: '🐢' }
		})
	).json();
	trackMember(member.id);
	await page.request.post('/api/chores', {
		data: {
			title: 'Water cress',
			icon: '🌱',
			stars: 1,
			memberIds: [member.id],
			schedule: { type: 'daily' },
			requiresApproval: false
		}
	});
	await page.context().clearCookies();
	await gotoHydrated(page, `/chores?member=${member.id}`);
	const cress = card(page, 'Water cress');
	const saved = page.waitForResponse((r) => r.url().includes('/complete'));
	await cress.getByTestId('did-it').click();
	expect((await saved).ok()).toBe(true);
	await expect(cress).toHaveAttribute('data-status', 'approved');
	await expect(page.getByTestId('jar-counts')).toContainText('1 gold star');
	const undone = page.waitForResponse((r) => r.url().includes('/undo'));
	await cress.getByTestId('undo').click();
	await expect(cress.getByTestId('did-it')).toBeVisible();
	await expect(page.getByTestId('jar-counts')).toContainText('0 gold stars');
	expect((await undone).ok()).toBe(true);
	await reloadHydrated(page);
	await expect(card(page, 'Water cress')).toHaveAttribute('data-status', 'undone');
});

test('an any-day job shows under This week until done, then stays done today @J1.9', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-kc-flex${info.project.name.replace(/\W/g, '')}`);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Pip ${Date.now() % 1e9}`, role: 'child', color: 'member-3', avatar: '🦉' }
		})
	).json();
	trackMember(member.id);
	await page.request.post('/api/chores', {
		data: {
			title: 'Tidy my room',
			icon: '🧹',
			stars: 2,
			memberIds: [member.id],
			schedule: { type: 'flex', every: 1 },
			requiresApproval: true
		}
	});
	await page.context().clearCookies();
	await gotoHydrated(page, `/chores?member=${member.id}`);
	await expect(page.getByRole('heading', { name: /This week · any day/ })).toBeAttached();
	const room = card(page, 'Tidy my room');
	await expect(room.getByTestId('flex-due')).toHaveText('Due by Sunday');
	await expectTappable(room.getByTestId('did-it'), 96);
	const saved = page.waitForResponse((r) => r.url().includes('/complete'));
	await room.getByTestId('did-it').click();
	await expect(room).toHaveAttribute('data-status', 'pending');
	expect((await saved).ok()).toBe(true);
	await reloadHydrated(page);
	await expect(card(page, 'Tidy my room')).toHaveAttribute('data-status', 'pending');
});

test('a new to-do is self-serve by default: gold at once, star flies, nothing waits @J1.2', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-kc-self${info.project.name.replace(/\W/g, '')}`);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Sunny ${Date.now() % 1e9}`, role: 'child', color: 'member-3', avatar: '🦉' }
		})
	).json();
	trackMember(member.id);
	const chore = await (
		await page.request.post('/api/chores', {
			data: { title: 'Tidy shelf', icon: '📚', stars: 2, memberIds: [member.id] }
		})
	).json();
	expect(chore.requiresApproval).toBe(false);
	await page.context().clearCookies();
	await gotoHydrated(page, `/chores?member=${member.id}`);
	const shelf = card(page, 'Tidy shelf');
	const saved = page.waitForResponse((r) => r.url().includes('/complete'));
	await shelf.getByTestId('did-it').click();
	// Gold from the tap itself, before the server answers: no "Waiting for grown-up" flash.
	await expect(shelf).toHaveAttribute('data-status', 'approved');
	await expect(page.getByTestId('flying-star')).toHaveCount(2, { timeout: 500 });
	await expect(shelf.getByTestId('waiting')).toHaveCount(0);
	expect((await saved).ok()).toBe(true);
	await expect(page.getByTestId('jar-counts')).toContainText('2 gold stars');
	await expect(page.getByTestId('jar-counts')).toContainText('0 waiting');
});

test('six Star Jobs and six habits fit the wall without page scrolling (hub-3yg) @J1.10', async ({
	page
}, info) => {
	await signInAsAdult(page, `adult-kc-fold${info.project.name.replace(/\W/g, '')}`);
	const member = await (
		await page.request.post('/api/members', {
			data: { name: `Fern ${Date.now() % 1e9}`, role: 'child', color: 'member-5', avatar: '🦋' }
		})
	).json();
	trackMember(member.id);
	// Spread over the three time columns, two Star Jobs and two habits in each.
	const times = ['morning', 'afternoon', 'evening'];
	for (let i = 0; i < 6; i++) {
		for (const kind of ['star_job', 'habit']) {
			const res = await page.request.post('/api/chores', {
				data: {
					title: `${kind === 'habit' ? 'Habit' : 'Job'} ${i + 1}`,
					icon: kind === 'habit' ? '🧺' : '🧹',
					stars: 1,
					kind,
					timeOfDay: times[i % 3],
					memberIds: [member.id],
					schedule: { type: 'daily' }
				}
			});
			expect(res.ok()).toBe(true);
		}
	}
	await page.context().clearCookies();
	// Only this child: kids other projects and workers seed in this run (the DB is fresh per run, but
	// shared by all projects within it) would add rows of avatars above the board.
	await page.route('**/api/members', async (route) => {
		const res = await route.fetch();
		const all = (await res.json()) as { id: string }[];
		await route.fulfill({ response: res, json: all.filter((m) => m.id === member.id) });
	});
	await gotoHydrated(page, `/chores?member=${member.id}`);
	await expect(page.getByTestId('chore-card')).toHaveCount(12);
	await expect(page.getByTestId('star-jobs-count')).toHaveText('0/6');
	await expect(page.getByTestId('habits-count')).toHaveText('0/6');

	if (info.project.name.includes('portrait')) {
		// Portrait stacks the columns: the Now column comes first and its first row is on screen.
		await expect(page.getByTestId('time-column').first()).toHaveAttribute('data-now', 'true');
		const box = (await page.getByTestId('chore-card').first().boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	} else {
		// Landscape: every row is on screen and the page itself never scrolls.
		const viewport = page.viewportSize()!;
		for (const row of await page.getByTestId('chore-card').all()) {
			const box = (await row.boundingBox())!;
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height, 'row below the fold').toBeLessThanOrEqual(viewport.height);
		}
		const scrolls = await page.evaluate(() =>
			[document.documentElement, document.querySelector('main')!].some(
				(el) => el.scrollHeight > el.clientHeight + 1
			)
		);
		expect(scrolls, 'the page scrolls').toBe(false);
	}
	await expectTappable(page.getByTestId('did-it').first(), 96);
});
