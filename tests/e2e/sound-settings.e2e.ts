import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';
import { gotoHydrated } from './hydrated';

// Page routes must see every request; the shared server's sound settings never change here.
test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

test('grown-ups mute sounds and move quiet hours past midnight', async ({ page }, info) => {
	const saved: unknown[] = [];
	await page.route('**/api/settings/sound', (route) => {
		if (route.request().method() === 'GET')
			return route.fulfill({ json: { muted: false, quietStart: '23:30', quietEnd: '07:00' } });
		saved.push(route.request().postDataJSON());
		return route.fulfill({ json: { muted: true, quietStart: '00:00', quietEnd: '07:00' } });
	});
	await signInAsAdult(page, `e2e-sound-adult-${info.project.name}`);
	await gotoHydrated(page, '/settings');
	const loaded = page.waitForResponse('**/api/settings/sound');
	await page.getByRole('link', { name: /Sound/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Sound' })).toBeVisible();
	await loaded;
	await expect(page.getByTestId('quietStart')).toHaveText('11:30 PM');
	await expect(page.getByTestId('quiet-summary')).toHaveText(
		'No sounds from 11:30 PM until 7:00 AM the next morning.'
	);

	const muted = page.getByRole('button', { name: 'Muted', exact: true });
	await expectTappable(muted);
	await muted.click();
	await expect(muted).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('button', { name: 'On', exact: true })).toHaveAttribute(
		'aria-pressed',
		'false'
	);

	const later = page.getByRole('button', { name: 'Quiet from: later' });
	await expectTappable(later);
	await expectTappable(page.getByRole('button', { name: 'Quiet from: earlier' }));
	await later.click();
	await later.click();
	await expect(page.getByTestId('quietStart')).toHaveText('12:00 AM');
	await expect(page.getByTestId('quiet-summary')).toHaveText(
		'No sounds from 12:00 AM until 7:00 AM.'
	);
	await expect
		.poll(() => saved)
		.toEqual([{ muted: true }, { quietStart: '23:45' }, { quietStart: '00:00' }]);
});

test('a failed save puts the setting back', async ({ page }, info) => {
	await page.route('**/api/settings/sound', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { muted: false, quietStart: '20:00', quietEnd: '07:00' } })
			: route.fulfill({ status: 500, body: 'nope' })
	);
	await signInAsAdult(page, `e2e-sound-fail-${info.project.name}`);
	const loaded = page.waitForResponse('**/api/settings/sound');
	await gotoHydrated(page, '/settings/sound');
	await loaded;
	await page.getByRole('button', { name: 'Until: earlier' }).click();
	await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.');
	await expect(page.getByTestId('quietEnd')).toHaveText('7:00 AM');
});
