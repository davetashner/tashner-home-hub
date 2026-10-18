import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

// The shared server's real power state is global, so the endpoints are mocked here.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('Wake the wall and Sleep now show the wall power state', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wall-power-${info.project.name}`);
	let state = { power: 'off', reason: 'sleep-now', mode: 'off', until: '2099-01-01T13:00:00.000Z' };
	const posts: string[] = [];
	await page.route('**/api/display/power', (route) => route.fulfill({ json: state }));
	await page.route('**/api/display/wake', async (route) => {
		posts.push(route.request().method());
		await new Promise((r) => setTimeout(r, 300));
		state = { power: 'on', reason: 'wake', mode: 'normal', until: '2099-01-01T21:00:00.000Z' };
		await route.fulfill({ json: state });
	});
	await page.route('**/api/display/sleep', (route) => {
		posts.push(route.request().method());
		state = { power: 'off', reason: 'sleep-now', mode: 'off', until: undefined as never };
		return route.fulfill({ status: 202, json: { power: 'off', reason: 'sleep-now', mode: 'off' } });
	});
	await page.goto('/settings/screen');
	const text = page.getByTestId('wall-power');
	await expect(text).toHaveText(/^Asleep until \d{1,2}:\d{2} [AP]M$/);
	await page.getByRole('button', { name: 'Wake the wall' }).click();
	await expect(text).toHaveText('Waking…');
	await expect(text).toHaveText(/^On until \d{1,2}:\d{2} [AP]M$/);
	await page.getByRole('button', { name: 'Sleep now' }).click();
	await expect(text).toHaveText('Asleep until someone wakes it');
	expect(posts).toEqual(['POST', 'POST']);
});

test('a failed wake restores the state and says why', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-wall-power-fail-${info.project.name}`);
	await page.route('**/api/display/power', (route) =>
		route.fulfill({ json: { power: 'off', reason: 'sleep-now', mode: 'off' } })
	);
	await page.route('**/api/display/wake', (route) => route.fulfill({ status: 503, body: '' }));
	await page.goto('/settings/screen');
	await expect(page.getByTestId('wall-power')).toHaveText('Asleep until someone wakes it');
	await page.getByRole('button', { name: 'Wake the wall' }).click();
	await expect(page.getByRole('alert')).toContainText("Couldn't reach the hub");
	await expect(page.getByTestId('wall-power')).toHaveText('Asleep until someone wakes it');
});
