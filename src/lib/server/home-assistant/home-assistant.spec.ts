import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { createKeyring } from '../domain/secrets.js';
import * as ha from './index.js';

const keyring = createKeyring('k1', { k1: randomBytes(32) });
let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const states = [
	{ entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen light' } },
	{ entity_id: 'scene.movie', state: 'scening', attributes: { friendly_name: 'Movie night' } },
	{ entity_id: 'sensor.t', state: '1', attributes: {} }
];

/** A stub HA: records calls, answers by path. */
function stub(status = 200, body: unknown = states) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

function connect() {
	ha.saveConnection(
		{ baseUrl: 'http://homeassistant.local:8123/', token: 'tok-123' },
		{ db, keyring }
	);
}

describe('connection storage', () => {
	it('stores the token sealed and never returns it', () => {
		connect();
		const raw = db
			.select()
			.from(settings)
			.all()
			.find((r) => r.key === 'homeassistant.connection')!;
		expect(raw.value).not.toContain('tok-123');
		expect(JSON.stringify(ha.readConfig({ db }))).not.toContain('tok');
		expect(ha.readConfig({ db })).toMatchObject({
			configured: true,
			baseUrl: 'http://homeassistant.local:8123',
			hasToken: true
		});
	});
	it('keeps the saved token on a blank edit, and keeps the picks', () => {
		connect();
		ha.saveTiles([{ entityId: 'light.kitchen', name: '' }], { db });
		ha.saveConnection({ baseUrl: 'http://10.0.0.5:8123', token: '' }, { db, keyring });
		expect(ha.readConfig({ db }).tiles).toHaveLength(1);
		expect(ha.readConfig({ db }).baseUrl).toBe('http://10.0.0.5:8123');
	});
	it('rejects a bad address, a missing token, and picks before connecting', () => {
		expect(() => ha.saveConnection({ baseUrl: 'ftp://x', token: 't' }, { db, keyring })).toThrow(
			ha.HaError
		);
		expect(() => ha.saveConnection({ baseUrl: 'http://h', token: '' }, { db, keyring })).toThrow(
			/token/
		);
		expect(() => ha.saveTiles([], { db })).toThrow(/first/);
	});
	it('reads as unconfigured, and after disconnect', () => {
		expect(ha.readConfig({ db }).configured).toBe(false);
		connect();
		ha.disconnect({ db });
		expect(ha.readConfig({ db }).configured).toBe(false);
		db.insert(settings).values({ key: 'homeassistant.connection', value: '{bad' }).run();
		expect(ha.readConfig({ db }).configured).toBe(false);
	});
});

describe('calls to Home Assistant', () => {
	it('tests the connection with a bearer token, no redirects', async () => {
		connect();
		const s = stub(200, { message: 'API running.' });
		expect(await ha.testConnection(undefined, { db, keyring, fetch: s.fetch })).toEqual({
			message: 'API running.'
		});
		expect(s.calls[0]!.url).toBe('http://homeassistant.local:8123/api/');
		expect(s.calls[0]!.init.redirect).toBe('manual');
		expect((s.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
			'Bearer tok-123'
		);
	});
	it('tests unsaved values without needing a saved connection', async () => {
		const s = stub(200, {});
		const r = await ha.testConnection(
			{ baseUrl: '192.168.1.9:8123', token: ' abc ' },
			{ db, keyring, fetch: s.fetch }
		);
		expect(r.message).toBe('Connected');
		expect(s.calls[0]!.url).toBe('http://192.168.1.9:8123/api/');
	});
	it('maps failures', async () => {
		connect();
		const d = (f: typeof fetch) => ({ db, keyring, fetch: f });
		await expect(ha.testConnection(undefined, d(stub(401).fetch))).rejects.toMatchObject({
			kind: 'rejected'
		});
		await expect(ha.testConnection(undefined, d(stub(500).fetch))).rejects.toMatchObject({
			kind: 'unreachable'
		});
		const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
		await expect(ha.testConnection(undefined, d(down))).rejects.toThrow(
			'Home Assistant unreachable'
		);
		await expect(
			ha.testConnection(undefined, { db: openDb(':memory:'), keyring })
		).rejects.toMatchObject({
			kind: 'invalid'
		});
		await expect(
			ha.testConnection({ baseUrl: 'http://h', token: '' }, { db: openDb(':memory:'), keyring })
		).rejects.toThrow(/token/);
	});
	it('says so when the saved token cannot be decrypted', async () => {
		connect();
		const other = createKeyring('k1', { k1: randomBytes(32) });
		await expect(
			ha.testConnection(undefined, { db, keyring: other, fetch: stub().fetch })
		).rejects.toThrow(/Paste it again/);
	});
	it('lists pickable entities', async () => {
		connect();
		const list = await ha.listEntities({ db, keyring, fetch: stub().fetch });
		expect(list.map((e) => e.entityId)).toEqual(['light.kitchen', 'scene.movie']);
	});
});

describe('wall tiles', () => {
	it('is unconfigured until something is picked', async () => {
		expect(await ha.readTiles({ db, keyring })).toEqual({ configured: false });
		connect();
		expect(await ha.readTiles({ db, keyring })).toEqual({ configured: false });
	});
	it('maps live state, and degrades when HA is down', async () => {
		connect();
		ha.saveTiles(
			[
				{ entityId: 'light.kitchen', name: '' },
				{ entityId: 'scene.movie', name: 'Movies' }
			],
			{ db }
		);
		const ok = await ha.readTiles({ db, keyring, fetch: stub().fetch });
		expect(ok).toMatchObject({ configured: true, reachable: true });
		expect(ok.configured && ok.tiles.map((t) => [t.name, t.on])).toEqual([
			['Kitchen light', true],
			['Movies', null]
		]);
		const down = vi.fn().mockRejectedValue(new Error('x')) as unknown as typeof fetch;
		const bad = await ha.readTiles({ db, keyring, fetch: down });
		expect(bad).toMatchObject({ configured: true, reachable: false });
		expect(bad.configured && bad.tiles).toHaveLength(2);
	});
	it('rethrows unexpected errors', async () => {
		connect();
		ha.saveTiles([{ entityId: 'light.kitchen', name: '' }], { db });
		const broken = { ...{ db, keyring }, fetch: undefined } as ha.Deps;
		const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
			throw new TypeError('boom');
		});
		// fetch throwing is reported as unreachable by call(); a non-HaError would come from elsewhere.
		expect(await ha.readTiles(broken)).toMatchObject({ reachable: false });
		spy.mockRestore();
	});
});

describe('activate', () => {
	beforeEach(() => {
		connect();
		ha.saveTiles(
			[
				{ entityId: 'light.kitchen', name: '' },
				{ entityId: 'scene.movie', name: '' }
			],
			{ db }
		);
	});
	it('toggles a light and activates a scene', async () => {
		const s = stub(200, []);
		await ha.activate('light.kitchen', { db, keyring, fetch: s.fetch });
		await ha.activate('scene.movie', { db, keyring, fetch: s.fetch });
		expect(s.calls.map((c) => c.url)).toEqual([
			'http://homeassistant.local:8123/api/services/light/toggle',
			'http://homeassistant.local:8123/api/services/scene/turn_on'
		]);
		expect(s.calls[0]!.init.body).toBe(JSON.stringify({ entity_id: 'light.kitchen' }));
	});
	it('refuses a picked sensor: sensors are read-only', async () => {
		ha.saveTiles([{ entityId: 'sensor.hall', name: '' }], { db });
		const s = stub();
		await expect(ha.activate('sensor.hall', { db, keyring, fetch: s.fetch })).rejects.toMatchObject(
			{
				kind: 'invalid'
			}
		);
		expect(s.calls).toHaveLength(0);
	});
	it('refuses anything that is not a picked tile', async () => {
		const s = stub();
		for (const bad of ['light.other', 'lock.front', 5, undefined])
			await expect(ha.activate(bad, { db, keyring, fetch: s.fetch })).rejects.toMatchObject({
				kind: 'invalid'
			});
		expect(s.calls).toHaveLength(0);
	});
});

describe('sensor tiles', () => {
	it('returns readings for picked sensors and contacts', async () => {
		connect();
		ha.saveTiles(
			[
				{ entityId: 'sensor.hall', name: '' },
				{ entityId: 'binary_sensor.door', name: 'Back door' }
			],
			{ db }
		);
		const s = stub(200, [
			{
				entity_id: 'sensor.hall',
				state: '19.26',
				last_updated: new Date().toISOString(),
				attributes: { device_class: 'temperature', unit_of_measurement: '°C' }
			},
			{ entity_id: 'binary_sensor.door', state: 'on', attributes: { device_class: 'door' } }
		]);
		const r = await ha.readTiles({ db, keyring, fetch: s.fetch });
		expect(r).toMatchObject({
			reachable: true,
			tiles: [
				{ kind: 'sensor', reading: '19.3 °C', stale: false },
				{ kind: 'contact', name: 'Back door', reading: 'Open', open: true }
			]
		});
		expect(JSON.stringify(r)).not.toContain('token');
		expect(s.calls.every((c) => c.init.method === 'GET')).toBe(true);
	});
});
