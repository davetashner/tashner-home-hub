import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

// Synthetic bulbs; every lights request is mocked so no UDP leaves the test server.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const lamp = {
	mac: '000000000001',
	ip: '10.0.0.5',
	name: 'Light 1',
	reachable: true,
	on: true,
	dimming: 50,
	color: null
};
const porch = {
	mac: '000000000002',
	ip: '10.0.0.6',
	name: 'Light 2',
	reachable: false,
	on: false,
	dimming: 100,
	color: null
};

test('grown-ups find, name, switch and dim lights @J17.8', async ({ page }, info) => {
	const patches: unknown[] = [];
	await page.route('**/api/lights', (route) => route.fulfill({ json: { lights: [] } }));
	await page.route('**/api/lights/search', (route) =>
		route.fulfill({ json: { lights: [lamp, porch] } })
	);
	await page.route('**/api/lights/0*', (route) => {
		if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
		return route.fulfill({ json: { ok: true } });
	});
	await signInAsAdult(page, `e2e-lights-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	await page.getByRole('link', { name: /Lights Find the WiZ bulbs/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Lights' })).toBeVisible();
	await expect(page.getByTestId('lights-empty')).toBeVisible();

	const find = page.getByRole('button', { name: 'Find lights' });
	await expectTappable(find);
	await find.click();
	await expect(page.getByTestId('light')).toHaveCount(2);
	await expect(page.getByTestId('light-offline')).toHaveCount(1);

	const off = page
		.getByRole('group', { name: 'Light 1 power' })
		.getByRole('button', { name: 'Off' });
	await expectTappable(off);
	await off.click();
	await expect(off).toHaveAttribute('aria-pressed', 'true');

	const blue = page
		.getByRole('group', { name: 'Light 1 color' })
		.getByRole('button', { name: 'Blue' });
	await expectTappable(blue);
	await blue.click();
	await expect(blue).toHaveAttribute('aria-pressed', 'true');
	await expect(off).toHaveAttribute('aria-pressed', 'false');

	await page.getByRole('slider', { name: 'Light 1 brightness' }).fill('80');
	await expect(page.getByText('80%')).toBeVisible();

	const name = page.getByRole('textbox', { name: 'Name of Light 1' });
	await name.fill('Lamp');
	await name.press('Enter');
	await expect
		.poll(() => patches)
		.toEqual([{ on: false }, { on: true, color: 'blue' }, { dimming: 80 }, { name: 'Lamp' }]);

	const forget = page.getByRole('button', { name: 'Forget Light 2' });
	await expectTappable(forget);
	await forget.click();
	await expect(page.getByTestId('light')).toHaveCount(1);
});

test('a bulb that does not confirm goes back and says so @J17.8', async ({ page }, info) => {
	await page.route('**/api/lights', (route) => route.fulfill({ json: { lights: [lamp] } }));
	await page.route('**/api/lights/0*', (route) =>
		route.fulfill({ status: 502, json: { message: 'Light 1 did not answer. Try Find lights.' } })
	);
	await signInAsAdult(page, `e2e-lights-fail-${info.project.name}`);
	await gotoHydrated(page, '/settings/lights');
	const on = page.getByRole('group', { name: 'Light 1 power' }).getByRole('button', { name: 'On' });
	await expect(on).toHaveAttribute('aria-pressed', 'true');
	await page
		.getByRole('group', { name: 'Light 1 power' })
		.getByRole('button', { name: 'Off' })
		.click();
	await expect(page.getByRole('alert')).toHaveText('Light 1 did not answer. Try Find lights.');
	await expect(on).toHaveAttribute('aria-pressed', 'true');
});
