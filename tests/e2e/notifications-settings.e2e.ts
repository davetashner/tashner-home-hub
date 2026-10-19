import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated, reloadHydrated } from './hydrated';

// The API is faked in the browser so nothing reaches the internet or the shared server's settings.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('grown-ups save notification settings and send a test @J9.8', async ({ page }, info) => {
	let state: Record<string, unknown> = {
		enabled: false,
		serverUrl: 'https://ntfy.sh',
		topic: '',
		baseUrl: '',
		events: { approval: true, goal: true },
		tokenSaved: false,
		last: null
	};
	const saved: Record<string, unknown>[] = [];
	await page.route('**/api/settings/notifications', (route) => {
		const method = route.request().method();
		if (method === 'PUT') {
			const { token, ...rest } = route.request().postDataJSON() as Record<string, unknown>;
			saved.push({ ...rest, token });
			state = { ...state, ...rest, tokenSaved: state.tokenSaved || token !== undefined };
		}
		if (method === 'POST') state.last = { ok: true, at: Date.now(), detail: 'Sent' };
		return route.fulfill({ json: method === 'POST' ? state.last : state });
	});
	await signInAsAdult(page, `e2e-notify-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Notifications/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();

	await expectTappable(page.getByTestId('notify-enabled'));
	await page.getByTestId('notify-enabled').click();
	await page.getByTestId('notify-topic').fill('synthetic-topic');
	await page.getByTestId('notify-token').fill('tk_synthetic');
	await page.getByTestId('notify-event-goal').click();
	await page.getByTestId('notify-save').click();
	await expect(page.getByTestId('notify-message')).toHaveText('Saved.');
	await expect(page.getByTestId('notify-token')).toHaveAttribute('placeholder', 'saved');
	expect(saved[0]).toMatchObject({ topic: 'synthetic-topic', token: 'tk_synthetic' });

	await page.getByTestId('notify-test').click();
	await expect(page.getByTestId('notify-last')).toContainText('Last send: Sent');

	await reloadHydrated(page);
	await expect(page.getByTestId('notify-topic')).toHaveValue('synthetic-topic');
	await expect(page.getByTestId('notify-enabled')).toHaveAttribute('aria-pressed', 'true');
});

test('a late config load does not overwrite what the adult typed @J9.8', async ({ page }, info) => {
	const server = {
		enabled: false,
		serverUrl: 'https://ntfy.sh',
		topic: 'from-server',
		baseUrl: '',
		events: { approval: true, goal: true },
		tokenSaved: false,
		last: null
	};
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	let held = 0;
	await page.route('**/api/settings/notifications', async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		held++;
		await gate;
		await route.fulfill({ json: server });
	});
	await signInAsAdult(page, `e2e-notify-late-${info.project.name}`);
	await gotoHydrated(page, '/settings/notifications');
	await expect.poll(() => held).toBeGreaterThan(0);
	// Edited while the load is still in flight (inputs are never blocked).
	await page.getByTestId('notify-topic').fill('typed-topic');
	await page.getByTestId('notify-enabled').click();
	release();
	await expect(page.getByTestId('notify-topic')).toHaveValue('typed-topic');
	await expect(page.getByTestId('notify-enabled')).toHaveAttribute('aria-pressed', 'true');
});
