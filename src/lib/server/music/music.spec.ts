import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { MusicError } from '#lib/server/domain/music.js';
import { SpotifyError } from '#lib/server/domain/spotify.js';
import * as music from './index.js';
import { musicResponse } from './http.js';

let db: Db;
let calls: { path: string; method: string; body?: string }[];
let routes: Record<string, () => Response>;
const jsonRes = (b: unknown, status = 200) =>
	new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const deps = () => ({
	db,
	now: () => Date.now(),
	api: async (path: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		calls.push({ path, method, body: init?.body as string | undefined });
		const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
		return key ? routes[key]!() : new Response(null, { status: 204 });
	}
});
const HUB = { id: 'dev1', name: 'Hub', is_active: true, volume_percent: 90 };

beforeEach(() => {
	db = openDb(':memory:');
	calls = [];
	routes = { 'GET /v1/me/player/devices': () => jsonRes({ devices: [HUB, { name: 'x' }] }) };
});

const curate = (extra: Record<string, unknown> = {}) =>
	music.saveMusicConfig(
		{ playlists: [{ id: 'pl1', name: 'Wake up', cover: null, tracks: 3 }], ...extra },
		deps()
	);

describe('config', () => {
	it('round-trips and repairs', () => {
		expect(music.getMusicConfig(deps()).volumeCap).toBe(70);
		curate({ volumeCap: 50, timerMinutes: 15 });
		const c = music.saveMusicConfig({ device: 'Pixel' }, deps());
		expect(c).toMatchObject({ volumeCap: 50, timerMinutes: 15, device: 'Pixel' });
		expect(c.playlists).toHaveLength(1);
	});
	it('survives corrupt stored json', () => {
		db.$client
			.prepare("insert into settings (key, value, updated_at) values ('music.config','{bad',0)")
			.run();
		expect(music.getMusicConfig(deps()).volumeCap).toBe(70);
	});
});

describe('library and devices', () => {
	it('pages through playlists', async () => {
		let n = 0;
		routes['GET /v1/me/playlists'] = () =>
			jsonRes({
				items: [{ id: `p${n}`, name: `List ${n}`, images: [], tracks: { total: 2 } }, null],
				next: ++n < 2 ? 'more' : null
			});
		const lib = await music.listLibrary(deps());
		expect(lib.map((p) => p.id)).toEqual(['p0', 'p1']);
		expect(calls[1]!.path).toContain('offset=50');
	});
	it('maps device lists and failures', async () => {
		expect(await music.listDevices(deps())).toEqual([
			{ id: 'dev1', name: 'Hub', isActive: true, volumePercent: 90 }
		]);
		routes['GET /v1/me/player/devices'] = () => jsonRes({}, 500);
		await expect(music.listDevices(deps())).rejects.toMatchObject({ code: 'spotify' });
		routes['GET /v1/me/playlists'] = () => jsonRes({}, 403);
		await expect(music.listLibrary(deps())).rejects.toMatchObject({ code: 'not_allowed' });
		routes['GET /v1/me/player/devices'] = () => jsonRes({ devices: undefined });
		expect(await music.listDevices(deps())).toEqual([]);
	});
});

describe('SpotifyError mapping', () => {
	it('maps SpotifyError to MusicError', async () => {
		const bad = (m: string, re = false) => ({
			db,
			api: async () => {
				throw new SpotifyError(m, re);
			}
		});
		await expect(music.listDevices(bad('Spotify is not connected'))).rejects.toMatchObject({
			code: 'not_connected'
		});
		await expect(music.listDevices(bad('x', true))).rejects.toMatchObject({
			code: 'not_connected'
		});
		await expect(music.listDevices(bad('Could not reach Spotify'))).rejects.toMatchObject({
			code: 'spotify'
		});
		await expect(
			music.listDevices({ db, api: async () => Promise.reject(new TypeError('boom')) })
		).rejects.toThrow('boom');
	});
});

describe('musicResponse', () => {
	it('maps errors to typed json', async () => {
		const res = await musicResponse(async () => {
			throw new MusicError('no_device', 'The speaker is asleep');
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ code: 'no_device', message: 'The speaker is asleep' });
		await expect(
			musicResponse(async () => {
				throw new Error('x');
			})
		).rejects.toThrow('x');
	});
});
