import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { SpotifyError } from '#lib/server/domain/spotify.js';
import * as music from './playback.js';
import { saveMusicConfig } from './index.js';

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
	vi.useFakeTimers();
	db = openDb(':memory:');
	calls = [];
	routes = { 'GET /v1/me/player/devices': () => jsonRes({ devices: [HUB, { name: 'x' }] }) };
	music.cancelTimer();
});
afterEach(() => {
	music.cancelTimer();
	vi.useRealTimers();
});

const curate = (extra: Record<string, unknown> = {}) =>
	saveMusicConfig(
		{ playlists: [{ id: 'pl1', name: 'Wake up', cover: null, tracks: 3 }], ...extra },
		deps()
	);

describe('playback', () => {
	it('rejects playlists that are not curated', async () => {
		await expect(music.playPlaylist('nope', deps())).rejects.toMatchObject({ code: 'invalid' });
		expect(calls).toHaveLength(0);
	});
	it('transfers, plays the context, caps the volume and starts the timer', async () => {
		routes['PUT '] = () => new Response(null, { status: 204 });
		curate({ volumeCap: 60, timerMinutes: 10 });
		await music.playPlaylist('pl1', deps());
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'GET /v1/me/player/devices',
			'PUT /v1/me/player',
			'PUT /v1/me/player/play?device_id=dev1',
			'PUT /v1/me/player/volume?volume_percent=60'
		]);
		expect(JSON.parse(calls[2]!.body!)).toEqual({ context_uri: 'spotify:playlist:pl1' });
		calls.length = 0;
		await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /v1/me/player/pause']);
	});
	it('does not start a timer when off, and pause cancels it', async () => {
		curate({ timerMinutes: 0 });
		await music.playPlaylist('pl1', deps());
		expect((await music.musicState(deps())).timerRemainingSec).toBeNull();
		saveMusicConfig({ timerMinutes: 10 }, deps());
		await music.resume(deps());
		expect((await music.musicState(deps())).timerRemainingSec).toBe(600);
		await music.pause(deps());
		calls.length = 0;
		await vi.advanceTimersByTimeAsync(11 * 60_000);
		expect(calls).toHaveLength(0);
	});
	it('swallows a failed timer pause', async () => {
		curate({ timerMinutes: 10 });
		await music.resume(deps());
		routes['PUT /v1/me/player/pause'] = () => jsonRes({}, 500);
		await vi.advanceTimersByTimeAsync(11 * 60_000);
		expect(calls.at(-1)!.path).toBe('/v1/me/player/pause');
	});
	it('reports an asleep speaker', async () => {
		curate();
		routes['GET /v1/me/player/devices'] = () => jsonRes({ devices: [] });
		await expect(music.playPlaylist('pl1', deps())).rejects.toMatchObject({ code: 'no_device' });
		routes['GET /v1/me/player/devices'] = () => jsonRes({ devices: [HUB] });
		routes['PUT /v1/me/player'] = () => jsonRes({}, 404);
		await expect(music.playPlaylist('pl1', deps())).rejects.toMatchObject({ code: 'no_device' });
	});
	it('next, previous and clamped volume', async () => {
		curate({ volumeCap: 40 });
		await music.next(deps());
		await music.previous(deps());
		expect(await music.setVolume(90, deps())).toBe(40);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'POST /v1/me/player/next',
			'POST /v1/me/player/previous',
			'PUT /v1/me/player/volume?volume_percent=40'
		]);
	});
	it('maps SpotifyError to MusicError', async () => {
		const bad = (m: string, re = false) => ({
			db,
			api: async () => {
				throw new SpotifyError(m, re);
			}
		});
		await expect(music.next(bad('Spotify is not connected'))).rejects.toMatchObject({
			code: 'not_connected'
		});
		await expect(music.next(bad('x', true))).rejects.toMatchObject({ code: 'not_connected' });
		await expect(music.next(bad('Could not reach Spotify'))).rejects.toMatchObject({
			code: 'spotify'
		});
		await expect(
			music.next({ db, api: async () => Promise.reject(new TypeError('boom')) })
		).rejects.toThrow('boom');
	});
});

describe('musicState', () => {
	const player =
		(over: Record<string, unknown> = {}) =>
		() =>
			jsonRes({
				is_playing: true,
				device: { id: 'dev1', volume_percent: 55 },
				item: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] },
				context: { uri: 'spotify:playlist:pl1' },
				...over
			});
	it('describes what is playing', async () => {
		curate();
		routes['GET /v1/me/player'] = player();
		expect(await music.musicState(deps())).toMatchObject({
			connected: true,
			online: true,
			isPlaying: true,
			track: 'Song',
			artist: 'A, B',
			playlist: { id: 'pl1', name: 'Wake up' },
			volume: 55,
			device: 'Hub'
		});
	});
	it('handles idle, other devices, unknown contexts and a missing speaker', async () => {
		curate();
		routes['GET /v1/me/player'] = () => new Response(null, { status: 204 });
		expect(await music.musicState(deps())).toMatchObject({
			online: true,
			isPlaying: false,
			volume: 90
		});
		routes['GET /v1/me/player'] = player({ device: { id: 'other' } });
		expect((await music.musicState(deps())).isPlaying).toBe(false);
		routes['GET /v1/me/player'] = player({ context: null, item: null, is_playing: false });
		expect(await music.musicState(deps())).toMatchObject({
			playlist: null,
			track: null,
			artist: null
		});
		routes['GET /v1/me/player'] = player({ context: { uri: 'spotify:playlist:zzz' } });
		expect((await music.musicState(deps())).playlist).toBeNull();
		routes['GET /v1/me/player'] = () => jsonRes({}, 500);
		expect((await music.musicState(deps())).online).toBe(true);
		routes['GET /v1/me/player/devices'] = () => jsonRes({ devices: [] });
		expect((await music.musicState(deps())).online).toBe(false);
	});
	it('reads Spotify trouble as offline and a missing login as not connected', async () => {
		routes['GET /v1/me/player/devices'] = () => jsonRes({}, 500);
		expect(await music.musicState(deps())).toMatchObject({ connected: true, online: false });
		const d = {
			db,
			api: async () => {
				throw new SpotifyError('Spotify is not connected');
			}
		};
		expect((await music.musicState(d)).connected).toBe(false);
	});
});
