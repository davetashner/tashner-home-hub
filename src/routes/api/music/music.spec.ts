import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
vi.mock('#lib/server/spotify/index.js', () => ({
	spotifyFetch: async (path: string) =>
		new Response(
			JSON.stringify(path.startsWith('/v1/me/player/devices') ? { devices: [] } : { items: [] })
		)
}));

const playlists = await import('./playlists/+server.js');
const settings = await import('./settings/+server.js');
const library = await import('./library/+server.js');
const devices = await import('./devices/+server.js');

const ev = (over: Record<string, unknown>) => over as never;
const adult = { locals: { adult: { id: 'a1', name: 'Adult' } } };

beforeEach(() => {
	db = openDb(':memory:');
});

describe('music settings routes', () => {
	it('are adult only, and curation is readable by kids', async () => {
		expect(() => settings.GET(ev({ locals: {} }))).toThrow();
		expect(() => library.GET(ev({ locals: {} }))).toThrow();
		expect(() => devices.GET(ev({ locals: {} }))).toThrow();
		const res = await settings.PUT(
			ev({
				...adult,
				request: new Request('http://h/x', {
					method: 'PUT',
					body: JSON.stringify({
						playlists: [{ id: 'pl1', name: 'Bath' }],
						volumeCap: 50,
						timerMinutes: 20,
						bogus: 1
					})
				})
			})
		);
		expect(await res.json()).toMatchObject({ volumeCap: 50, timerMinutes: 20 });
		expect(await (await settings.GET(ev(adult))).json()).toMatchObject({ volumeCap: 50 });
		const list = await playlists.GET(ev({}));
		expect(await list.json()).toEqual([{ id: 'pl1', name: 'Bath', cover: null, tracks: 0 }]);
	});

	it('lists the library and devices for adults', async () => {
		expect(await (await library.GET(ev(adult))).json()).toEqual([]);
		expect(await (await devices.GET(ev(adult))).json()).toEqual([]);
	});
});
