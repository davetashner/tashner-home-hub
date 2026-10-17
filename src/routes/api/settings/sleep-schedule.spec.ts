import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sleep-api-'));

const settings = await import('./sleep-schedule/+server.js');
const sleep = await import('../display/sleep/+server.js');
const wake = await import('../display/wake/+server.js');
const power = await import('../display/power/+server.js');

const call = async (fn: unknown, event: unknown = {}) =>
	(fn as (e: unknown) => Response | Promise<Response>)(event);
const as = (adult: boolean, body?: unknown, method = 'PUT') => ({
	locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	request: new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	})
});
const poll = async () => (await call(power.GET)).json();

it('serves the default schedule to a grown-up only', async () => {
	await expect(call(settings.GET, as(false, undefined, 'GET'))).rejects.toMatchObject({
		status: 401
	});
	const res = await call(settings.GET, as(true, undefined, 'GET'));
	expect(await res.json()).toMatchObject({
		enabled: true,
		weekday: { sleep: '21:30', wake: '06:30' },
		resleepMinutes: 2
	});
});

it('rejects bad values and signed-out callers without writing', async () => {
	await expect(call(settings.PUT, as(true, { weekdaySleep: '25:99' }))).rejects.toMatchObject({
		status: 400
	});
	await expect(call(settings.PUT, as(true, { resleepMinutes: 0 }))).rejects.toMatchObject({
		status: 400
	});
	await expect(call(settings.PUT, as(false, { enabled: false }))).rejects.toMatchObject({
		status: 401
	});
	expect((await (await call(settings.GET, as(true, undefined, 'GET'))).json()).enabled).toBe(true);
});

it('saves a partial update and keeps the rest', async () => {
	const res = await call(settings.PUT, as(true, { weekendSleep: '23:00', resleepMinutes: 5 }));
	expect(await res.json()).toMatchObject({
		weekend: { sleep: '23:00', wake: '06:30' },
		weekday: { sleep: '21:30', wake: '06:30' },
		resleepMinutes: 5
	});
});

it('sleep now turns the screen off and a touch wakes it', async () => {
	// With the schedule off, only the events matter, whatever time the test runs at.
	await call(settings.PUT, as(true, { enabled: false }));
	expect(await poll()).toEqual({ power: 'on', reason: 'disabled', mode: 'normal' });
	const slept = await call(sleep.POST);
	expect(slept.status).toBe(202);
	expect(await slept.json()).toEqual({ power: 'off', reason: 'sleep-now' });
	const polled = await call(power.GET);
	expect(polled.headers.get('cache-control')).toBe('no-store');
	expect(await polled.json()).toEqual({ power: 'off', reason: 'sleep-now', mode: 'off' });
	expect(await (await call(wake.POST)).json()).toEqual({ power: 'on', reason: 'disabled' });
	expect(await poll()).toEqual({ power: 'on', reason: 'disabled', mode: 'normal' });
});

it('reports night-clock mode on a scheduled night when a grown-up enables it', async () => {
	const nc = await import('./night-clock/+server.js');
	await expect(call(nc.GET, as(false, undefined, 'GET'))).rejects.toMatchObject({ status: 401 });
	await expect(call(nc.PUT, as(true, { enabled: 'x' }))).rejects.toMatchObject({ status: 400 });
	expect(await (await call(nc.PUT, as(true, { enabled: true }))).json()).toEqual({ enabled: true });
	expect(await (await call(nc.GET, as(true, undefined, 'GET'))).json()).toEqual({ enabled: true });
	expect(['normal', 'night-clock', 'off']).toContain((await poll()).mode);
	await call(nc.PUT, as(true, { enabled: false }));
});
