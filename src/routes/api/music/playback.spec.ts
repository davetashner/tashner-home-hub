import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));
const apiCalls: string[] = [];
vi.mock('#lib/server/spotify/index.js', () => ({
	spotifyFetch: async (path: string, init?: RequestInit) => {
		apiCalls.push(`${init?.method ?? 'GET'} ${path}`);
		if (path.startsWith('/v1/me/player/devices'))
			return new Response(JSON.stringify({ devices: [] }), { status: 200 });
		return new Response(JSON.stringify({ items: [] }), { status: 200 });
	}
}));

const settings = await import('./settings/+server.js');
const play = await import('./play/+server.js');
const volume = await import('./volume/+server.js');
const state = await import('./state/+server.js');
const pause = await import('./pause/+server.js');
const resume = await import('./resume/+server.js');
const next = await import('./next/+server.js');
const previous = await import('./previous/+server.js');

const ev = (over: Record<string, unknown>) => over as never;
const adult = { locals: { adult: { id: 'a1', name: 'Adult' } } };
const body = (b: unknown) => new Request('http://h/x', { method: 'POST', body: JSON.stringify(b) });

beforeEach(() => {
	db = openDb(':memory:');
	apiCalls.length = 0;
});

describe('playback routes', () => {
	it('refuses a playlist that is not curated, answers asleep when no speaker', async () => {
		const bad = await play.POST(ev({ request: body({ playlistId: 'nope' }) }));
		expect(bad.status).toBe(400);
		expect(await bad.json()).toMatchObject({ code: 'invalid' });
		await settings.PUT(
			ev({
				...adult,
				request: new Request('http://h/x', {
					method: 'PUT',
					body: JSON.stringify({ playlists: [{ id: 'pl1', name: 'Bath' }] })
				})
			})
		);
		const asleep = await play.POST(ev({ request: body({ playlistId: 'pl1' }) }));
		expect(asleep.status).toBe(409);
		expect(await asleep.json()).toMatchObject({ code: 'no_device' });
	});

	it('transport, volume and state', async () => {
		expect((await pause.POST(ev({}))).status).toBe(200);
		expect((await resume.POST(ev({}))).status).toBe(200);
		expect((await next.POST(ev({}))).status).toBe(200);
		expect((await previous.POST(ev({}))).status).toBe(200);
		const v = await volume.POST(ev({ request: body({ percent: 100 }) }));
		expect(await v.json()).toEqual({ percent: 70 });
		expect(await (await state.GET(ev({}))).json()).toMatchObject({ online: false, volumeCap: 70 });
		expect(apiCalls).toContain('PUT /v1/me/player/volume?volume_percent=70');
	});
});
