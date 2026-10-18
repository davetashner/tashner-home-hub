import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { px } from './tap';

test.beforeAll(ensureHousehold);

const JSON_HEADERS = { 'content-type': 'application/json' };

// Synthetic games site, served by the test itself.
test('an adult adds a game, it shows on the Games tab, opens in a frame and Back returns @J14.1', async ({
	page
}, info) => {
	// The hub's address must never reach a game host: record every Referer it sees.
	const seen: { kind: string; referer: string | undefined }[] = [];
	await page.route('https://games.example.com/**', (route) => {
		const req = route.request();
		seen.push({ kind: req.resourceType(), referer: req.headers()['referer'] });
		return route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Space Hop</title><h1 id="g">Space Hop is running</h1>'
		});
	});
	await signInAsAdult(page, 'e2e-games-adult');
	const tag = `${info.project.name.slice(5, 9)}${Date.now().toString(36)}`;
	const name = `Space Hop ${tag}`;
	let id = '';
	try {
		await page.goto('/settings/games');
		await page.waitForLoadState('networkidle');
		const add = page.getByTestId('add-game');
		await expect(async () => {
			await add.click();
			await expect(page.getByTestId('game-form')).toBeVisible({ timeout: 1000 });
		}).toPass();
		await page.getByTestId('game-title').fill(name);
		await page.getByTestId('game-url').fill('http://games.example.com/space-hop/index.html');
		await page.getByTestId('game-save').click();
		await expect(page.getByRole('alert')).toContainText('https');
		await page.getByTestId('game-url').fill('https://games.example.com/space-hop/index.html');
		await page.getByTestId('game-save').click();
		const row = page.getByTestId('game-row').filter({ hasText: name });
		await expect(row).toBeVisible();
		const list = (await (await page.request.get('/api/games')).json()) as {
			id: string;
			title: string;
		}[];
		id = list.find((g) => g.title === name)!.id;

		await page.goto('/games');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible();
		const tile = page.getByTestId('game-tile').filter({ hasText: name });
		await expect(tile).toBeVisible();
		const box = (await tile.boundingBox())!;
		expect(px(box.height)).toBeGreaterThanOrEqual(96);
		expect(px(box.width)).toBeGreaterThanOrEqual(96);

		const player = page.getByTestId('game-player');
		await expect(async () => {
			await tile.click();
			await expect(player).toBeVisible({ timeout: 1000 });
		}).toPass();
		await expect(page.frameLocator('[data-testid="game-player"] iframe').locator('#g')).toHaveText(
			'Space Hop is running'
		);
		await expect(page.locator('[data-testid="game-player"] iframe')).toHaveAttribute(
			'referrerpolicy',
			'no-referrer'
		);
		await expect.poll(() => seen.map((s) => s.kind)).toContain('fetch');
		expect(seen.some((s) => s.kind === 'document')).toBe(true);
		expect(seen.filter((s) => s.referer !== undefined)).toEqual([]);
		const back = page.getByTestId('game-back');
		const backBox = (await back.boundingBox())!;
		expect(px(backBox.height)).toBeGreaterThanOrEqual(96);
		expect(px(backBox.width)).toBeGreaterThanOrEqual(96);
		await back.click();
		await expect(player).toBeHidden();
		await expect(tile).toBeVisible();
	} finally {
		if (id) await page.request.delete(`/api/games/${id}`, { headers: JSON_HEADERS, data: {} });
	}
});

test('a game that cannot load shows a friendly message @J14.2', async ({ page }, info) => {
	await page.route('https://games.example.com/**', (route) => route.abort('internetdisconnected'));
	await signInAsAdult(page, 'e2e-games-adult');
	const name = `Offline ${info.project.name.slice(5, 9)}${Date.now().toString(36)}`;
	const res = await page.request.post('/api/games', {
		headers: JSON_HEADERS,
		data: { title: name, url: 'https://games.example.com/offline/index.html' }
	});
	expect(res.status(), await res.text()).toBe(201);
	const { id } = (await res.json()) as { id: string };
	try {
		await page.goto('/games');
		await page.waitForLoadState('networkidle');
		const tile = page.getByTestId('game-tile').filter({ hasText: name });
		await expect(async () => {
			await tile.click();
			await expect(page.getByTestId('game-player')).toBeVisible({ timeout: 1000 });
		}).toPass();
		await expect(page.getByTestId('game-offline')).toContainText('Games need the internet', {
			timeout: 20_000
		});
		await page.getByTestId('game-back').click();
		await expect(page.getByTestId('game-player')).toBeHidden();
	} finally {
		await page.request.delete(`/api/games/${id}`, { headers: JSON_HEADERS, data: {} });
	}
});

test('the game form warns about home-network addresses but still lets them save @J14.3', async ({
	page
}) => {
	await signInAsAdult(page, 'e2e-games-adult');
	await page.goto('/settings/games');
	await page.waitForLoadState('networkidle');
	const add = page.getByTestId('add-game');
	await expect(async () => {
		await add.click();
		await expect(page.getByTestId('game-form')).toBeVisible({ timeout: 1000 });
	}).toPass();
	const warning = page.getByTestId('game-lan-warning');
	await page.getByTestId('game-url').fill('https://192.168.1.50/game');
	await expect(warning).toContainText('home network');
	await page.getByTestId('game-url').fill('https://games.example.com/');
	await expect(warning).toHaveCount(0);
});
