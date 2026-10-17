import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-weather-api-'));

const { getDb } = await import('#lib/server/db/index.js');
const wx = await import('#lib/server/weather.js');
const settingsRoute = await import('../settings/weather/+server.js');
const searchRoute = await import('../settings/weather/search/+server.js');
const weatherRoute = await import('./+server.js');

const payload = {
	current: { temperature_2m: 20, weather_code: 0, is_day: 1, wind_speed_10m: 5 },
	daily: {
		time: ['2030-01-07'],
		weather_code: [0],
		temperature_2m_max: [25],
		temperature_2m_min: [10],
		precipitation_probability_max: [5]
	}
};
const ok = (body: unknown) => vi.fn(async (_u: string) => new Response(JSON.stringify(body)));
const event = (adult: boolean, extra: object = {}) => ({
	locals: { adult: adult ? { id: 'a', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	...extra
});
const call = (fn: unknown, e: unknown) => (fn as (e: unknown) => unknown)(e);

it('is off until a location is set', async () => {
	expect(wx.getWeather(getDb(), ok(payload))).toBeNull();
	expect(await (call(weatherRoute.GET, {}) as Response).json()).toEqual({ enabled: false });
});

it('requires an adult to set or search', async () => {
	const req = new Request('http://x/', { method: 'PUT', body: '{"lat":1,"lon":2}' });
	await expect(
		Promise.resolve().then(() => call(settingsRoute.PUT, event(false, { request: req })))
	).rejects.toMatchObject({ status: 401 });
	await expect(
		call(searchRoute.GET, event(false, { url: new URL('http://x/?q=ab') })) as Promise<Response>
	).rejects.toMatchObject({ status: 401 });
});

it('rejects a bad location and saves a good one', async () => {
	const put = (body: unknown) =>
		call(
			settingsRoute.PUT,
			event(true, {
				request: new Request('http://x/', { method: 'PUT', body: JSON.stringify(body) })
			})
		) as Promise<Response>;
	await expect(put({ lat: 100, lon: 0 })).rejects.toMatchObject({ status: 400 });
	const res = await put({ lat: 1.5, lon: 2.5, name: 'Testville', unit: 'C' });
	expect((await res.json()).location.unit).toBe('C');
	expect(
		((await (call(settingsRoute.GET, {}) as Response).json()) as { location: { name: string } })
			.location.name
	).toBe('Testville');
});

it('serves instantly, refreshes in the background, and keeps stale data offline', async () => {
	const db = getDb();
	const f = ok(payload);
	const first = wx.getWeather(db, f, 1000);
	expect(first?.snapshot).toBeNull();
	await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
	expect(f.mock.calls[0][0]).toContain('celsius');
	await vi.waitFor(() => expect(wx.getWeather(db, f, 2000)?.snapshot?.current.temp).toBe(20));
	// fresh: no new fetch
	const calls = f.mock.calls.length;
	wx.getWeather(db, f, 3000);
	expect(f.mock.calls.length).toBe(calls);
	// offline refresh keeps the last good data
	const down = vi.fn(async () => {
		throw new Error('offline');
	});
	expect(await wx.refreshWeather(db, down, 99_999_999)).toBeNull();
	expect(wx.getWeather(db, down, 4000)?.snapshot?.current.temp).toBe(20);
	expect(
		await wx.refreshWeather(
			db,
			vi.fn(async (_u: string) => new Response('x', { status: 500 }))
		)
	).toBeNull();
	expect(await wx.refreshWeather(db, ok({ nope: 1 }))).toBeNull();
});

it('searches places and fails soft', async () => {
	const f = ok({ results: [{ name: 'Testville', latitude: 1, longitude: 2 }] });
	expect(await wx.searchPlaces('Test', f)).toEqual([{ lat: 1, lon: 2, name: 'Testville' }]);
	expect(await wx.searchPlaces('a', f)).toEqual([]);
	expect(
		await wx.searchPlaces(
			'Test',
			vi.fn(async () => {
				throw new Error('x');
			})
		)
	).toEqual([]);
});

it('turns weather off again', async () => {
	await (call(settingsRoute.DELETE, event(true)) as Response).json();
	expect(wx.readWeatherLocation(getDb())).toBeNull();
	expect(wx.refreshWeather(getDb(), ok(payload))).resolves.toBeNull();
	expect(wx.startWeatherScheduler({ HUB_WEATHER: 'off' })).toBeUndefined();
});
