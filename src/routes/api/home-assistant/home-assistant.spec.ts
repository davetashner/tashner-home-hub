import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const cfg = await import('../settings/home-assistant/+server.js');
const test = await import('../settings/home-assistant/test/+server.js');
const entities = await import('../settings/home-assistant/entities/+server.js');
const picks = await import('../settings/home-assistant/tiles/+server.js');
const tiles = await import('./tiles/+server.js');
const toggle = await import('./toggle/+server.js');

const states = [
	{ entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen light' } }
];
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const adult = { locals: { adult: { id: 'a1', name: 'Adult' } } };
const req = (body: unknown, method = 'POST') =>
	new Request('http://h/x', {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
const ev = (extra: Record<string, unknown>) => extra as never;

beforeEach(() => {
	db = openDb(':memory:');
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => new Response(JSON.stringify(states)));
});

describe('Home Assistant routes', () => {
	it('settings routes are adult only', async () => {
		const kid = ev({ locals: {}, request: req({}) });
		expect(() => cfg.GET(kid)).toThrow();
		await expect(cfg.PUT(kid)).rejects.toBeDefined();
		expect(() => cfg.DELETE(kid)).toThrow();
		await expect(test.POST(kid)).rejects.toBeDefined();
		await expect(entities.GET(kid)).rejects.toBeDefined();
		await expect(picks.PUT(kid)).rejects.toBeDefined();
	});

	it('connect, test, pick, read, toggle', async () => {
		let r = await cfg.PUT(
			ev({
				...adult,
				request: req({ baseUrl: 'http://ha.local:8123', token: 'secret-token' }, 'PUT')
			})
		);
		expect(await r.json()).toMatchObject({ configured: true, hasToken: true });

		r = await test.POST(ev({ ...adult, request: req({}) }));
		expect(r.status).toBe(200);

		r = await entities.GET(ev(adult));
		expect((await r.json()).entities[0].entityId).toBe('light.kitchen');

		r = await picks.PUT(
			ev({
				...adult,
				request: req({ tiles: [{ entityId: 'light.kitchen', name: 'Counter' }] }, 'PUT')
			})
		);
		expect((await r.json()).tiles).toHaveLength(1);

		r = await tiles.GET(ev({}));
		expect(await r.json()).toMatchObject({
			configured: true,
			reachable: true,
			tiles: [{ name: 'Counter', on: true }]
		});

		r = await toggle.POST(ev({ request: req({ entityId: 'light.kitchen' }) }));
		expect(await r.json()).toEqual({ ok: true });
		expect(fetchMock.mock.calls.at(-1)![0]).toBe('http://ha.local:8123/api/services/light/toggle');

		await expect(toggle.POST(ev({ request: req({ entityId: 'light.x' }) }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('maps HA errors to statuses', async () => {
		await expect(
			cfg.PUT(ev({ ...adult, request: req({ baseUrl: 'nope://', token: 't' }, 'PUT') }))
		).rejects.toMatchObject({ status: 400 });
		await cfg.PUT(
			ev({ ...adult, request: req({ baseUrl: 'http://ha.local', token: 't' }, 'PUT') })
		);
		fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
		await expect(test.POST(ev({ ...adult, request: req({}) }))).rejects.toMatchObject({
			status: 401
		});
		fetchMock.mockRejectedValue(new Error('down'));
		await expect(test.POST(ev({ ...adult, request: req({}) }))).rejects.toMatchObject({
			status: 502
		});
	});

	it('tests unsaved values and disconnects', async () => {
		const r = await test.POST(
			ev({ ...adult, request: req({ baseUrl: 'http://ha.local', token: 'abc' }) })
		);
		expect(r.status).toBe(200);
		await cfg.PUT(
			ev({ ...adult, request: req({ baseUrl: 'http://ha.local', token: 'abc' }, 'PUT') })
		);
		const d = await cfg.DELETE(ev({ ...adult, request: req({}, 'DELETE') }));
		expect(await d.json()).toMatchObject({ configured: false });
		expect(await (await cfg.GET(ev(adult))).json()).toMatchObject({ configured: false });
		expect(await (await tiles.GET(ev({}))).json()).toEqual({ configured: false });
	});
});
