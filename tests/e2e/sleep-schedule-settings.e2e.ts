import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { expectTappable } from './tap';

test.use({ serviceWorkers: 'block' });
test.beforeAll(ensureHousehold);

const defaults = {
	enabled: true,
	weekday: { sleep: '21:30', wake: '06:30' },
	weekend: { sleep: '21:30', wake: '06:30' },
	resleepMinutes: 2
};

test('grown-ups change a school-night time and the re-sleep timeout', async ({ page }, info) => {
	await signInAsAdult(page, `e2e-sleep-settings-${info.project.name}`);
	// Both projects share one server and one schedule: both write the same values, assert on their
	// own request's response and on the page, and put the defaults back at the end.
	try {
		await page.goto('/settings');
		await page.getByRole('link', { name: /Sleep schedule/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Sleep schedule' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Weekend nights (Fri–Sat)' })).toBeVisible();
		await expect(page.getByTestId('weekdaySleep')).toBeVisible();

		const later = page.getByRole('button', { name: 'School nights (Sun–Thu) Lights out: later' });
		await expectTappable(later);
		await expectTappable(page.getByRole('button', { name: 'Off', exact: true }));
		const timeSaved = page.waitForResponse(
			(r) => r.request().method() === 'PUT' && r.request().postData() === '{"weekdaySleep":"21:45"}'
		);
		await later.click();
		await expect(page.getByTestId('weekdaySleep')).toHaveText('9:45 PM');
		expect(await (await timeSaved).json()).toMatchObject({ weekday: { sleep: '21:45' } });

		const more = page.getByRole('button', { name: 'Minutes before sleeping again: more' });
		await expectTappable(more);
		const minutesSaved = page.waitForResponse(
			(r) => r.request().method() === 'PUT' && r.request().postData() === '{"resleepMinutes":3}'
		);
		await more.click();
		await expect(page.getByTestId('resleep-summary')).toContainText('sleeps again after 3 minutes');
		expect(await (await minutesSaved).json()).toMatchObject({ resleepMinutes: 3 });
	} finally {
		const restored = await page.request.put('/api/settings/sleep-schedule', {
			data: {
				enabled: true,
				weekdaySleep: '21:30',
				weekdayWake: '06:30',
				weekendSleep: '21:30',
				weekendWake: '06:30',
				resleepMinutes: 2
			}
		});
		expect(await restored.json()).toEqual(defaults);
	}
});

test('a failed save puts the setting back', async ({ page }, info) => {
	await page.route('**/api/settings/sleep-schedule', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: defaults })
			: route.fulfill({ status: 500, body: 'nope' })
	);
	await signInAsAdult(page, `e2e-sleep-settings-fail-${info.project.name}`);
	const loaded = page.waitForResponse('**/api/settings/sleep-schedule');
	await page.goto('/settings/sleep-schedule');
	await loaded;
	await page.getByRole('button', { name: 'Weekend nights (Fri–Sat) Wake up: later' }).click();
	await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.');
	await expect(page.getByTestId('weekendWake')).toHaveText('6:30 AM');
});
