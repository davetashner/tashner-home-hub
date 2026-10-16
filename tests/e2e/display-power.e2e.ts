import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

test('an adult sets the schedule; sleep now and wake drive the power endpoint', async ({
	page
}, info) => {
	// The schedule is global: run it in one viewport so the projects don't edit it at once.
	test.skip(!info.project.name.includes('landscape'), 'edits shared server state');
	await signInAsAdult(page, `e2e-sleep-adult-${info.project.name}`);
	const defaults = {
		enabled: true,
		weekday: { sleep: '21:30', wake: '06:30' },
		weekend: { sleep: '21:30', wake: '06:30' },
		resleepMinutes: 2
	};
	const put = (data: object) => page.request.put('/api/settings/sleep-schedule', { data });
	try {
		// Schedule off so the answers below don't depend on the time of day.
		const saved = await put({ enabled: false, weekdaySleep: '21:45' });
		expect(await saved.json()).toMatchObject({ enabled: false, weekday: { sleep: '21:45' } });
		expect((await put({ weekdaySleep: '99:00' })).status()).toBe(400);

		const power = async () => {
			const res = await page.request.get('/api/display/power');
			expect(res.headers()['cache-control']).toBe('no-store');
			return (await res.json()).power;
		};
		expect((await page.request.post('/api/display/sleep', { data: {} })).status()).toBe(202);
		await expect.poll(power).toBe('off');
		await page.request.post('/api/display/wake', { data: {} });
		await expect.poll(power).toBe('on');
	} finally {
		await put({ ...defaults, weekdaySleep: '21:30' });
	}
	expect(await (await page.request.get('/api/settings/sleep-schedule')).json()).toEqual(defaults);
});

test('signed-out callers cannot read or change the schedule', async ({ request }) => {
	expect((await request.get('/api/settings/sleep-schedule')).status()).toBe(401);
	const res = await request.put('/api/settings/sleep-schedule', { data: { enabled: false } });
	expect(res.status()).toBe(401);
});
