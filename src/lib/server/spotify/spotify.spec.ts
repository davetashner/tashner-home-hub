import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '#lib/server/db/index.js';
import { createKeyring } from '#lib/server/domain/secrets.js';

process.env.HUB_SECRET_KEY = randomBytes(32).toString('base64');

let db: Db;
vi.mock('#lib/server/db/index.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.js')>()),
	getDb: () => db
}));

const sp = await import('#lib/server/spotify/index.js');

const keyring = createKeyring('a', { a: randomBytes(32) });
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
	url: string;
	init: RequestInit;
}
let calls: Call[];
let script: Response[];
let t = 1_000_000;
const fetchMock = (async (url: string, init: RequestInit) => {
	calls.push({ url: String(url), init });
	const next = script.shift();
	if (!next) throw new Error('unscripted fetch ' + url);
	return next;
}) as unknown as typeof fetch;
const deps = () => ({ db, keyring, fetch: fetchMock, now: () => t, clientId: 'cid' });
const tokenBody = (c: Call) => new URLSearchParams(String(c.init.body));

beforeEach(() => {
	db = openDb(':memory:');
	calls = [];
	script = [];
	t = 1_000_000;
	sp.resetSpotifyCache();
});

async function connect(extra = {}) {
	script.push(
		json({ access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }),
		json({ display_name: 'Pat Example', id: 'u1' })
	);
	await sp.completeLogin({ code: 'c1', verifier: 'ver', redirectUri: 'https://h/cb' }, deps());
	calls = [];
	return extra;
}

describe('completeLogin', () => {
	it('sends the PKCE verifier (no secret), stores the sealed refresh token and name', async () => {
		script.push(
			json({ access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }),
			json({ display_name: 'Pat Example' })
		);
		const r = await sp.completeLogin(
			{ code: 'c1', verifier: 'ver', redirectUri: 'https://h/cb' },
			deps()
		);
		expect(r.displayName).toBe('Pat Example');
		const b = tokenBody(calls[0]!);
		expect(b.get('grant_type')).toBe('authorization_code');
		expect(b.get('code_verifier')).toBe('ver');
		expect(b.get('code')).toBe('c1');
		expect(b.get('client_secret')).toBeNull();
		expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer acc1');
		const raw = JSON.stringify(db.$client.prepare('select value from settings').all());
		expect(raw).not.toContain('ref1');
		expect(sp.spotifyStatus(deps())).toEqual({ state: 'connected', displayName: 'Pat Example' });
	});

	it('falls back to the user id when there is no display name', async () => {
		script.push(json({ access_token: 'a', refresh_token: 'r' }), json({ id: 'u9' }));
		expect(
			(await sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())).displayName
		).toBe('u9');
	});

	it('reports a rejected code, missing refresh token, and a 403 for unlisted accounts', async () => {
		script.push(json({ error: 'invalid_grant' }, 400));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/Start again/);
		script.push(json({ access_token: 'a' }));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/long-lived/);
		script.push(json({ access_token: 'a', refresh_token: 'r' }), json({}, 403));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/User Management/);
		script.push(json({ access_token: 'a', refresh_token: 'r' }), json({}, 500));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/500/);
		script.push(json({ error: 'invalid_client' }, 400));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/CLIENT_ID/);
		script.push(json({}, 502));
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, deps())
		).rejects.toThrow(/502/);
		await expect(
			sp.completeLogin(
				{ code: 'c', verifier: 'v', redirectUri: 'x' },
				{ ...deps(), clientId: null }
			)
		).rejects.toThrow(/not set up/);
		expect(sp.spotifyStatus(deps())).toEqual({ state: 'disconnected' });
	});

	it('maps a network failure to a safe message', async () => {
		const boom = (async () => {
			throw new Error('ECONNRESET secret-ish');
		}) as unknown as typeof fetch;
		await expect(
			sp.completeLogin({ code: 'c', verifier: 'v', redirectUri: 'x' }, { ...deps(), fetch: boom })
		).rejects.toThrow('Could not reach Spotify');
	});
});

describe('spotifyFetch', () => {
	it('uses the cached access token until near expiry, then refreshes', async () => {
		await connect();
		script.push(json({ ok: 1 }), json({ ok: 2 }));
		await sp.spotifyFetch('/v1/me/player', {}, deps());
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe('https://api.spotify.com/v1/me/player');
		expect((calls[0]!.init.headers as Headers).get('authorization')).toBe('Bearer acc1');
		t += 3600_000;
		script.unshift(json({ access_token: 'acc2', expires_in: 3600 }));
		await sp.spotifyFetch('/v1/me/player', { method: 'PUT' }, deps());
		expect(tokenBody(calls[1]!).get('grant_type')).toBe('refresh_token');
		expect(tokenBody(calls[1]!).get('refresh_token')).toBe('ref1');
		expect((calls[2]!.init.headers as Headers).get('authorization')).toBe('Bearer acc2');
		expect(calls[2]!.init.method).toBe('PUT');
	});

	it('retries once on 401 with a fresh token and persists a rotated refresh token', async () => {
		await connect();
		script.push(
			json({}, 401),
			json({ access_token: 'acc2', refresh_token: 'ref2', expires_in: 3600 }),
			json({ ok: true })
		);
		const res = await sp.spotifyFetch('/v1/me/playlists', {}, deps());
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(3);
		expect((calls[2]!.init.headers as Headers).get('authorization')).toBe('Bearer acc2');
		// the rotated token is what the next refresh uses
		t += 3600_000;
		script.push(json({ access_token: 'acc3', expires_in: 3600 }), json({}));
		await sp.spotifyFetch('/v1/x', {}, deps());
		expect(tokenBody(calls[3]!).get('refresh_token')).toBe('ref2');
	});

	it('returns a second 401 instead of looping', async () => {
		await connect();
		script.push(json({}, 401), json({ access_token: 'acc2' }), json({}, 401));
		expect((await sp.spotifyFetch('/v1/x', {}, deps())).status).toBe(401);
		expect(calls).toHaveLength(3);
	});

	it('marks Spotify disconnected when the refresh token was revoked', async () => {
		await connect();
		script.push(json({}, 401), json({ error: 'invalid_grant' }, 400));
		await expect(sp.spotifyFetch('/v1/x', {}, deps())).rejects.toMatchObject({ needsReauth: true });
		expect(sp.spotifyStatus(deps())).toEqual({ state: 'reconnect', displayName: 'Pat Example' });
		await expect(sp.spotifyFetch('/v1/x', {}, deps())).rejects.toThrow(/Reconnect/);
		expect(calls).toHaveLength(2);
	});

	it('refuses cleanly when not set up or not connected', async () => {
		await expect(sp.spotifyFetch('/v1/x', {}, { ...deps(), clientId: null })).rejects.toThrow(
			/not set up/
		);
		await expect(sp.spotifyFetch('/v1/x', {}, deps())).rejects.toThrow(/not connected/);
		expect(sp.spotifyStatus({ ...deps(), clientId: null })).toEqual({ state: 'not_configured' });
	});

	it('disconnect forgets the account', async () => {
		await connect();
		sp.disconnectSpotify(deps());
		expect(sp.spotifyStatus(deps())).toEqual({ state: 'disconnected' });
	});

	it('reads the client id from the environment', () => {
		expect(sp.spotifyClientId({ HUB_SPOTIFY_CLIENT_ID: ' abc ' })).toBe('abc');
		expect(sp.spotifyClientId({})).toBeNull();
	});
});
