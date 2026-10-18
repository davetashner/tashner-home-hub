import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';

test.beforeAll(ensureHousehold);

test('an adult sets the schedule; sleep now and wake answer with the power state @J8.5', async ({
	page
}, info) => {
	await signInAsAdult(page, `e2e-sleep-adult-${info.project.name}`);
	const defaults = {
		enabled: true,
		weekday: { sleep: '21:30', wake: '06:30' },
		weekend: { sleep: '21:30', wake: '06:30' },
		resleepMinutes: 2
	};
	const put = (data: object) => page.request.put('/api/settings/sleep-schedule', { data });
	// Both projects run this at once on the shared server, so every check reads the response of
	// the call that made it (handled in one synchronous step) rather than a later GET.
	try {
		const saved = await put({ enabled: false, weekdaySleep: '21:45' });
		expect(await saved.json()).toMatchObject({ enabled: false, weekday: { sleep: '21:45' } });
		expect((await put({ weekdaySleep: '99:00' })).status()).toBe(400);

		const slept = await page.request.post('/api/display/sleep', { data: {} });
		expect(slept.status()).toBe(202);
		expect(slept.headers()['cache-control']).toBe('no-store');
		expect(await slept.json()).toMatchObject({ power: 'off', reason: 'sleep-now' });
		const woke = await page.request.post('/api/display/wake', { data: {} });
		expect((await woke.json()).power).toBe('on');
		const polled = await page.request.get('/api/display/power');
		expect(polled.headers()['cache-control']).toBe('no-store');
		expect(['on', 'off']).toContain((await polled.json()).power);
	} finally {
		const restored = await put({ ...defaults, weekdaySleep: '21:30' });
		expect(await restored.json()).toEqual(defaults);
	}
});

test('signed-out callers cannot read or change the schedule @J8.5', async ({ request }) => {
	expect((await request.get('/api/settings/sleep-schedule')).status()).toBe(401);
	const res = await request.put('/api/settings/sleep-schedule', { data: { enabled: false } });
	expect(res.status()).toBe(401);
});
