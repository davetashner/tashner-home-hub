import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { holdLock } from './file-lock';
import { gotoHydrated } from './hydrated';
import { px } from './tap';

test.beforeAll(ensureHousehold);

// The hub's HA routes are stubbed: no real Home Assistant is involved.
interface Tile {
	entityId: string;
	name: string;
	kind: 'toggle' | 'scene' | 'sensor' | 'contact';
	on: boolean | null;
	unavailable: boolean;
	reading?: string | null;
	open?: boolean | null;
	stale?: boolean;
}
const tiles = (): Tile[] => [
	{
		entityId: 'light.kitchen',
		name: 'Kitchen light',
		kind: 'toggle',
		on: false,
		unavailable: false
	},
	{ entityId: 'switch.fan', name: 'Porch fan', kind: 'toggle', on: true, unavailable: false },
	{ entityId: 'scene.movie', name: 'Movie night', kind: 'scene', on: null, unavailable: false }
];

async function stubTiles(page: Page, state: { reachable: boolean; toggleStatus: number }) {
	const model = tiles();
	const posts: string[] = [];
	await page.route('**/api/home-assistant/tiles', (route) =>
		route.fulfill({ json: { configured: true, reachable: state.reachable, tiles: model } })
	);
	await page.route('**/api/home-assistant/toggle', async (route) => {
		posts.push(route.request().postDataJSON().entityId);
		await new Promise((r) => setTimeout(r, 400));
		if (state.toggleStatus === 200) {
			const t = model.find((m) => m.entityId === posts.at(-1))!;
			if (t.on !== null) t.on = !t.on;
		}
		await route.fulfill({ status: state.toggleStatus, json: { ok: state.toggleStatus === 200 } });
	});
	return posts;
}

test('Home controls: big tiles flip at once and settle with the server @J17.1', async ({
	page
}) => {
	const posts = await stubTiles(page, { reachable: true, toggleStatus: 200 });
	await gotoHydrated(page, '/');
	const lamp = page.getByTestId('ha-tile').filter({ hasText: 'Kitchen light' });
	await expect(lamp).toHaveAttribute('data-on', 'false');
	const box = (await lamp.boundingBox())!;
	expect(px(box.height)).toBeGreaterThanOrEqual(96);
	expect(px(box.width)).toBeGreaterThanOrEqual(96);

	await lamp.click();
	// Optimistic: flipped while the stubbed server is still holding the response.
	await expect(lamp).toHaveAttribute('data-on', 'true', { timeout: 300 });
	await expect.poll(() => posts).toEqual(['light.kitchen']);

	await page.getByTestId('ha-tile').filter({ hasText: 'Movie night' }).click();
	await expect.poll(() => posts).toEqual(['light.kitchen', 'scene.movie']);
	await expect(page.getByTestId('ha-unreachable')).toHaveCount(0);
});

test('Home controls: a failed tap rolls back and says so @J17.2', async ({ page }) => {
	await stubTiles(page, { reachable: true, toggleStatus: 502 });
	await gotoHydrated(page, '/');
	const fan = page.getByTestId('ha-tile').filter({ hasText: 'Porch fan' });
	await expect(fan).toHaveAttribute('data-on', 'true');
	await fan.click();
	await expect(fan).toHaveAttribute('data-on', 'false', { timeout: 300 });
	await expect(fan).toHaveAttribute('data-on', 'true');
	await expect(page.getByRole('alert')).toContainText('Porch fan');
});

test('Home controls: shows Home Assistant unreachable gracefully @J17.3', async ({ page }) => {
	await stubTiles(page, { reachable: false, toggleStatus: 200 });
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('ha-unreachable')).toHaveText('Home Assistant unreachable');
	await expect(page.getByTestId('ha-tile')).toHaveCount(3);
});

test('Home controls: hidden when nothing is configured @J17.3', async ({ page }) => {
	await page.route('**/api/home-assistant/tiles', (route) =>
		route.fulfill({ json: { configured: false } })
	);
	await gotoHydrated(page, '/');
	await expect(page.getByTestId('home-controls')).toHaveCount(0);
});

test('Settings: connect, test, pick, rename and reorder @J17.4', async ({ page }) => {
	await signInAsAdult(page, 'e2e-ha-adult');
	let config = { configured: false, baseUrl: '', hasToken: false, tiles: [] as unknown[] };
	const puts: unknown[] = [];
	await page.route('**/api/settings/home-assistant', async (route) => {
		const m = route.request().method();
		if (m === 'PUT') {
			const b = route.request().postDataJSON();
			config = { ...config, configured: true, baseUrl: b.baseUrl, hasToken: true };
		}
		await route.fulfill({ json: config });
	});
	await page.route('**/api/settings/home-assistant/test', (route) =>
		route.fulfill({ json: { message: 'API running.' } })
	);
	await page.route('**/api/settings/home-assistant/entities', (route) =>
		route.fulfill({
			json: {
				entities: [
					{ entityId: 'light.kitchen', name: 'Kitchen light', domain: 'light' },
					{ entityId: 'switch.fan', name: 'Porch fan', domain: 'switch' },
					{ entityId: 'scene.movie', name: 'Movie night', domain: 'scene' }
				]
			}
		})
	);
	await page.route('**/api/settings/home-assistant/tiles', (route) => {
		puts.push(route.request().postDataJSON().tiles);
		return route.fulfill({ json: { tiles: route.request().postDataJSON().tiles } });
	});

	await gotoHydrated(page, '/settings/home-assistant');
	await page.getByTestId('ha-url').fill('http://homeassistant.local:8123');
	await page.getByTestId('ha-token').fill('synthetic-token');
	await page.getByTestId('ha-test').click();
	await expect(page.getByTestId('ha-test-result')).toContainText('Connected');
	await page.getByTestId('ha-save').click();

	const light = page.getByTestId('ha-entity').filter({ hasText: 'Kitchen light' });
	await light.click();
	await expect(light).toHaveAttribute('aria-checked', 'true');
	await page.getByTestId('ha-entity').filter({ hasText: 'Movie night' }).click();
	await expect(page.getByTestId('ha-pick')).toHaveCount(2);

	await page.getByLabel('Name for Kitchen light').fill('Counter');
	await page.getByLabel('Name for Kitchen light').blur();
	await page.getByRole('button', { name: 'Move Movie night up' }).click();
	await expect
		.poll(() => puts.at(-1))
		.toEqual([
			{ entityId: 'scene.movie', name: '' },
			{ entityId: 'light.kitchen', name: 'Counter' }
		]);
});

test('Home sensors: values, contacts, stale and unavailable are read-only @J17.5', async ({
	page
}) => {
	const sensors: Tile[] = [
		{
			entityId: 'sensor.hall',
			name: 'Hall',
			kind: 'sensor',
			on: null,
			unavailable: false,
			reading: '21.5 °C',
			open: null,
			stale: false
		},
		{
			entityId: 'binary_sensor.door',
			name: 'Front door',
			kind: 'contact',
			on: null,
			unavailable: false,
			reading: 'Open',
			open: true,
			stale: false
		},
		{
			entityId: 'sensor.cellar',
			name: 'Cellar',
			kind: 'sensor',
			on: null,
			unavailable: false,
			reading: '48 %',
			open: null,
			stale: true
		},
		{
			entityId: 'sensor.attic',
			name: 'Attic',
			kind: 'sensor',
			on: null,
			unavailable: true,
			reading: null,
			open: null,
			stale: false
		}
	];
	let posts = 0;
	await page.route('**/api/home-assistant/tiles', (route) =>
		route.fulfill({ json: { configured: true, reachable: true, tiles: sensors } })
	);
	await page.route('**/api/home-assistant/toggle', (route) => {
		posts++;
		return route.fulfill({ json: { ok: true } });
	});
	await gotoHydrated(page, '/');
	const card = (id: string) => page.locator(`[data-testid="ha-sensor"][data-entity="${id}"]`);
	await expect(card('sensor.hall')).toContainText('21.5 °C');
	await expect(card('binary_sensor.door')).toContainText('Open');
	await expect(card('sensor.cellar')).toHaveAttribute('data-state', 'stale');
	await expect(card('sensor.cellar')).toContainText('Not updating');
	await expect(card('sensor.attic')).toContainText('Unavailable');
	await card('sensor.hall').click();
	await page.waitForTimeout(300);
	expect(posts).toBe(0);
	await expect(page.getByTestId('ha-tile')).toHaveCount(0);
});

test('Home Assistant screen token: shown once, snippet filled in, then revoked @J17.6', async ({
	page,
	request
}) => {
	// Screen tokens are household-wide and all named alike, so the two wall projects take turns:
	// otherwise each can revoke the other's token and leave its own working.
	const release = await holdLock('ha-screen-token');
	try {
		await run();
	} finally {
		release();
	}
	async function run() {
		await signInAsAdult(page, 'e2e-ha-screen-adult');
		await gotoHydrated(page, '/settings/home-assistant');
		const card = page.getByTestId('ha-screen');
		await expect(card.getByTestId('ha-screen-yaml')).toContainText('<paste the token>');
		await card.getByTestId('ha-screen-new').click();
		const secret = (await card.getByTestId('ha-screen-secret').textContent())!.trim();
		expect(secret.length).toBeGreaterThanOrEqual(43);
		await expect(card.getByTestId('ha-screen-yaml')).toContainText(`Bearer ${secret}`);
		expect((await card.getByTestId('ha-screen-copy').boundingBox())!.height).toBeGreaterThanOrEqual(
			60
		);

		const call = (auth: string, state: string) =>
			request.post('/api/display/remote', {
				headers: { authorization: `Bearer ${auth}` },
				data: { state }
			});
		expect((await call(secret, 'wake')).status()).toBe(200);
		expect((await (await call(secret, 'sleep')).json()).power).toBe('off');
		expect((await call(secret, 'wake')).status()).toBe(200);

		// Revoke every listed token (any left by an aborted run too): ours is among them.
		const rows = card.getByTestId('ha-screen-token');
		await expect(rows.first()).toBeVisible();
		for (let left = await rows.count(); left > 0; left--) {
			await rows.first().getByTestId('ha-screen-revoke').click();
			await expect(rows).toHaveCount(left - 1);
		}
		await expect.poll(async () => (await call(secret, 'wake')).status()).toBe(401);
	}
});

test('Settings: a late config load does not overwrite what the adult typed @J17.4', async ({
	page
}) => {
	await signInAsAdult(page, 'e2e-ha-late-adult');
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	let held = 0;
	await page.route('**/api/settings/home-assistant', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		held++;
		await gate;
		await route.fulfill({
			json: { configured: true, baseUrl: 'http://stored.local:8123', hasToken: true, tiles: [] }
		});
	});
	await page.route('**/api/settings/home-assistant/entities', (route) =>
		route.fulfill({ json: { entities: [] } })
	);
	await gotoHydrated(page, '/settings/home-assistant');
	await expect.poll(() => held).toBeGreaterThan(0);
	// Typed while the load is in flight (the inputs are not blocked).
	await page.getByTestId('ha-url').fill('http://typed.local:8123');
	await page.getByTestId('ha-token').fill('synthetic-token');
	release();
	// The load landed: the saved connection is now known (Remove shows) ...
	await expect(page.getByTestId('ha-remove')).toBeVisible();
	// ... but the typed values survive.
	await expect(page.getByTestId('ha-url')).toHaveValue('http://typed.local:8123');
	await expect(page.getByTestId('ha-token')).toHaveValue('synthetic-token');
});

test('Motion wake: pick a sensor, the wall wakes on off to on, None stops polling @J17.7', async ({
	page,
	request
}) => {
	test.setTimeout(90_000);
	// The saved connection and the display power are household-wide, shared with the screen-token test above: they take turns.
	const release = await holdLock('ha-screen-token');
	const fake = await startFakeHa();
	try {
		await signInAsAdult(page, 'e2e-ha-motion-adult');
		// Start clean even if an aborted run left a connection behind.
		await page.request.delete('/api/settings/home-assistant');
		await gotoHydrated(page, '/settings/home-assistant');
		await page.getByTestId('ha-url').fill(fake.url);
		await page.getByTestId('ha-token').fill('synthetic-token');
		await page.getByTestId('ha-save').click();

		const card = page.getByTestId('ha-motion');
		const options = card.getByTestId('ha-motion-option');
		await expect(options).toHaveCount(3);
		// Motion-like sensors come first, then None is always first of all.
		await expect(options.nth(1)).toHaveAttribute('data-entity', 'binary_sensor.hall_motion');
		for (const o of await options.all()) {
			expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(60);
		}
		// A pick left by an aborted run would be saved already: start from None.
		await options.first().click();
		await expect(options.first()).toHaveAttribute('aria-checked', 'true');
		// Already on when first polled: no wake. Then off (seen), then on: wake.
		fake.state['binary_sensor.hall_motion'] = 'on';
		const pick = options.filter({ hasText: 'Hall motion' });
		await pick.click();
		await expect(pick).toHaveAttribute('aria-checked', 'true', { timeout: 300 });
		await expect.poll(() => fake.hits(), { timeout: 15_000 }).toBeGreaterThan(0);
		await request.post('/api/display/sleep', { data: {} });
		// Night clock keeps the monitor "on" at night, so read the reason, not just the power.
		const power = async () => (await (await request.get('/api/display/power')).json()).reason;
		await expect.poll(power).toBe('sleep-now');
		await page.waitForTimeout(7_000);
		expect(await power()).toBe('sleep-now');
		fake.state['binary_sensor.hall_motion'] = 'off';
		const seen = fake.hits();
		await expect.poll(() => fake.hits(), { timeout: 15_000 }).toBeGreaterThan(seen);
		await page.waitForTimeout(1_000);
		fake.state['binary_sensor.hall_motion'] = 'on';
		await expect.poll(power, { timeout: 20_000 }).not.toBe('sleep-now');

		// None stops polling.
		await options.first().click();
		await expect(options.first()).toHaveAttribute('aria-checked', 'true');
		await page.waitForTimeout(1_000);
		const after = fake.hits();
		await page.waitForTimeout(7_000);
		expect(fake.hits()).toBe(after);
	} finally {
		await page.request.delete('/api/settings/home-assistant');
		await fake.close();
		release();
	}
});

async function startFakeHa() {
	const state: Record<string, string> = { 'binary_sensor.hall_motion': 'off' };
	let hits = 0;
	const server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		const m = /^\/api\/states\/(.+)$/.exec(req.url ?? '');
		if (m) {
			hits++;
			const id = decodeURIComponent(m[1]!);
			res.end(JSON.stringify({ entity_id: id, state: state[id] ?? 'unknown' }));
		} else if (req.url === '/api/states') {
			res.end(
				JSON.stringify([
					{
						entity_id: 'binary_sensor.front_door',
						state: 'off',
						attributes: { device_class: 'door', friendly_name: 'Front door' }
					},
					{
						entity_id: 'binary_sensor.hall_motion',
						state: 'off',
						attributes: { device_class: 'motion', friendly_name: 'Hall motion' }
					}
				])
			);
		} else res.end(JSON.stringify({ message: 'API running.' }));
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const { port } = server.address() as AddressInfo;
	return {
		state,
		url: `http://127.0.0.1:${port}`,
		hits: () => hits,
		close: () => new Promise<void>((r) => server.close(() => r()))
	};
}
