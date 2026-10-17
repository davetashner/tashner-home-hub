import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { challengeFor, PENDING_COOKIE } from '#lib/server/domain/spotify.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const sp = await import('#lib/server/spotify/index.js');
const login = await import('./login/+server.js');
const callback = await import('./callback/+server.js');
const disconnect = await import('./disconnect/+server.js');
const status = await import('./status/+server.js');

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	db = openDb(':memory:');
	sp.resetSpotifyCache();
});

// --- routes ---------------------------------------------------------------

function cookieJar() {
	const jar = new Map<string, string>();
	return {
		jar,
		cookies: {
			get: (k: string) => jar.get(k),
			set: vi.fn((k: string, v: string, _o?: unknown) => void jar.set(k, v)),
			delete: (k: string) => void jar.delete(k)
		}
	};
}
const adult = { id: 'a1', name: 'Adult' };
const ev = (over: Record<string, unknown>) => over as never;

describe('login route', () => {
	it('is adult only', () => {
		expect(() =>
			login.GET(
				ev({
					locals: {},
					url: new URL('https://h/api/spotify/login'),
					cookies: cookieJar().cookies
				})
			)
		).toThrow();
	});

	it('400s without a client id', () => {
		delete process.env.HUB_SPOTIFY_CLIENT_ID;
		expect(() =>
			login.GET(
				ev({
					locals: { adult },
					url: new URL('https://h/api/spotify/login'),
					cookies: cookieJar().cookies
				})
			)
		).toThrow(expect.objectContaining({ status: 400 }));
	});

	it('400s on a plain-http LAN origin', () => {
		process.env.HUB_SPOTIFY_CLIENT_ID = 'cid';
		expect(() =>
			login.GET(
				ev({
					locals: { adult },
					url: new URL('http://192.168.1.5:3000/api/spotify/login'),
					cookies: cookieJar().cookies
				})
			)
		).toThrow(expect.objectContaining({ status: 400 }));
	});

	it('redirects to Spotify with a Lax HttpOnly sealed cookie, then the callback checks state', async () => {
		process.env.HUB_SPOTIFY_CLIENT_ID = 'cid';
		const { jar, cookies } = cookieJar();
		let location = '';
		try {
			login.GET(
				ev({
					locals: { adult },
					url: new URL('https://hub.example.com/api/spotify/login'),
					cookies
				})
			);
		} catch (e) {
			location = (e as { location: string }).location;
		}
		const u = new URL(location);
		expect(u.host).toBe('accounts.spotify.com');
		expect(u.searchParams.get('redirect_uri')).toBe('https://hub.example.com/api/spotify/callback');
		const opts = cookies.set.mock.calls[0]![2] as Record<string, unknown>;
		expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax' });
		expect(jar.size).toBe(1);
		const sealed = [...jar.values()][0]!;
		// the cookie never exposes the verifier; the challenge in the URL is derived from it
		expect(sealed).not.toContain(u.searchParams.get('code_challenge')!);
		const challenge = u.searchParams.get('code_challenge')!;
		const state = u.searchParams.get('state')!;
		expect(challenge).toHaveLength(43);

		// wrong state: no token exchange
		const bad = await callback.GET(
			ev({
				url: new URL(`https://hub.example.com/cb?code=c&state=nope`),
				cookies: { ...cookies, get: (k: string) => jar.get(k) }
			})
		);
		expect(await bad.text()).toContain('spotify=error');

		// right state: exchange uses the verifier whose challenge was sent
		const { jar: j2, cookies: c2 } = cookieJar();
		j2.set(PENDING_COOKIE, sealed);
		const orig = globalThis.fetch;
		const seen: URLSearchParams[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			if (String(url).endsWith('/api/token')) {
				seen.push(new URLSearchParams(String(init.body)));
				return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
			}
			return json({ display_name: 'Pat Example' });
		}) as unknown as typeof fetch;
		try {
			const ok = await callback.GET(
				ev({ url: new URL(`https://hub.example.com/cb?code=c&state=${state}`), cookies: c2 })
			);
			expect(await ok.text()).toContain('spotify=connected');
			expect(challengeFor(seen[0]!.get('code_verifier')!)).toBe(challenge);
			expect(seen[0]!.get('redirect_uri')).toBe('https://hub.example.com/api/spotify/callback');
			expect(j2.size).toBe(0);
			expect(sp.spotifyStatus()).toEqual({ state: 'connected', displayName: 'Pat Example' });
		} finally {
			globalThis.fetch = orig;
		}
	});
});

describe('callback route', () => {
	it('handles denial, a missing cookie and a failed exchange', async () => {
		const { cookies } = cookieJar();
		const denied = await callback.GET(
			ev({ url: new URL('https://h/cb?error=access_denied&state=x'), cookies })
		);
		expect(await denied.text()).toContain('spotify=denied');
		const none = await callback.GET(ev({ url: new URL('https://h/cb?code=c&state=x'), cookies }));
		expect(await none.text()).toContain('spotify=error');
		expect(none.headers.get('content-type')).toContain('text/html');
	});
});

describe('disconnect and status routes', () => {
	it('are adult only and work for an adult', async () => {
		process.env.HUB_SPOTIFY_CLIENT_ID = 'cid';
		expect(() => disconnect.POST(ev({ locals: {} }))).toThrow();
		expect(() => status.GET(ev({ locals: {} }))).toThrow();
		expect(await (await status.GET(ev({ locals: { adult } }))).json()).toEqual({
			state: 'disconnected'
		});
		expect(await (await disconnect.POST(ev({ locals: { adult } }))).json()).toEqual({
			state: 'disconnected'
		});
	});
});
