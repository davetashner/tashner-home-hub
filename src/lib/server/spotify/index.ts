import { eq } from 'drizzle-orm';
import { getDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { endpoints, openRefreshToken, sealRefreshToken, SpotifyError } from '../domain/spotify.js';
import type { Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';

const KEY = 'spotify.connection';
const TIMEOUT_MS = 15_000;
export const REAUTH_MESSAGE =
	'Spotify no longer accepts the saved sign-in. Reconnect it in Settings > Music.';

export type FetchFn = typeof fetch;

export interface Deps {
	db?: Db;
	keyring?: Keyring;
	fetch?: FetchFn;
	now?: () => number;
	clientId?: string | null;
}

interface Stored {
	displayName: string;
	/** Sealed with secret.key; null once Spotify revoked it. */
	refreshToken: string | null;
}

export type SpotifyStatus =
	| { state: 'not_configured' }
	| { state: 'disconnected' }
	| { state: 'reconnect'; displayName: string }
	| { state: 'connected'; displayName: string };

export function spotifyClientId(env: NodeJS.ProcessEnv = process.env): string | null {
	return env.HUB_SPOTIFY_CLIENT_ID?.trim() || null;
}

function read(db: Db): Stored | null {
	const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value) as Stored;
	} catch {
		return null;
	}
}

function write(db: Db, v: Stored): void {
	const value = JSON.stringify(v);
	db.insert(settings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

// Only one household account, so one access token cached for the process.
let cached: { token: string; expiresAt: number } | undefined;
export function resetSpotifyCache(): void {
	cached = undefined;
}

export function spotifyStatus(deps: Deps = {}): SpotifyStatus {
	const clientId = deps.clientId === undefined ? spotifyClientId() : deps.clientId;
	if (!clientId) return { state: 'not_configured' };
	const s = read(deps.db ?? getDb());
	if (!s) return { state: 'disconnected' };
	return { state: s.refreshToken ? 'connected' : 'reconnect', displayName: s.displayName };
}

export function disconnectSpotify(deps: Deps = {}): void {
	(deps.db ?? getDb()).delete(settings).where(eq(settings.key, KEY)).run();
	resetSpotifyCache();
}

async function call(f: FetchFn, url: string, init: RequestInit): Promise<Response> {
	try {
		return await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch {
		throw new SpotifyError('Could not reach Spotify');
	}
}

interface TokenBody {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
}

async function tokenRequest(f: FetchFn, params: Record<string, string>): Promise<TokenBody> {
	const res = await call(f, endpoints.token, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params)
	});
	const body = (await res.json().catch(() => ({}))) as TokenBody;
	if (res.ok && body.access_token) return body;
	if (body.error === 'invalid_grant') throw new SpotifyError(REAUTH_MESSAGE, true);
	if (body.error === 'invalid_client')
		throw new SpotifyError('Spotify rejected HUB_SPOTIFY_CLIENT_ID in the hub .env');
	throw new SpotifyError(`Spotify sign-in failed (${res.status})`);
}

/** Finishes the login: trades the code for tokens, learns the display name, stores the refresh token. */
export async function completeLogin(
	p: { code: string; verifier: string; redirectUri: string },
	deps: Deps = {}
): Promise<{ displayName: string }> {
	const f = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const clientId = deps.clientId ?? spotifyClientId();
	if (!clientId) throw new SpotifyError('Spotify is not set up yet');
	let t: TokenBody;
	try {
		t = await tokenRequest(f, {
			grant_type: 'authorization_code',
			client_id: clientId,
			code: p.code,
			redirect_uri: p.redirectUri,
			code_verifier: p.verifier
		});
	} catch (e) {
		if (e instanceof SpotifyError && e.needsReauth)
			throw new SpotifyError('Spotify rejected that sign-in or it expired. Start again');
		throw e;
	}
	if (!t.refresh_token) throw new SpotifyError('Spotify did not return a long-lived sign-in');
	const me = await call(f, `${endpoints.api}/v1/me`, {
		headers: { authorization: `Bearer ${t.access_token}` }
	});
	if (!me.ok) {
		void me.body?.cancel();
		throw new SpotifyError(
			me.status === 403
				? 'Spotify refused this account. In developer mode, add it under User Management in the Spotify app'
				: `Spotify answered ${me.status}`
		);
	}
	const profile = (await me.json().catch(() => ({}))) as { display_name?: string; id?: string };
	const displayName = profile.display_name || profile.id || 'Spotify';
	write(deps.db ?? getDb(), {
		displayName,
		refreshToken: sealRefreshToken(deps.keyring ?? getKeyring(), t.refresh_token)
	});
	cached = { token: t.access_token!, expiresAt: now() + (t.expires_in ?? 3600) * 1000 };
	return { displayName };
}

async function accessToken(deps: Deps, force: boolean): Promise<string> {
	const now = (deps.now ?? Date.now)();
	if (!force && cached && cached.expiresAt - 60_000 > now) return cached.token;
	const db = deps.db ?? getDb();
	const keyring = deps.keyring ?? getKeyring();
	const stored = read(db);
	const clientId = deps.clientId === undefined ? spotifyClientId() : deps.clientId;
	if (!clientId) throw new SpotifyError('Spotify is not set up yet');
	if (!stored) throw new SpotifyError('Spotify is not connected');
	if (!stored.refreshToken) throw new SpotifyError(REAUTH_MESSAGE, true);
	let t: TokenBody;
	try {
		t = await tokenRequest(deps.fetch ?? fetch, {
			grant_type: 'refresh_token',
			client_id: clientId,
			refresh_token: openRefreshToken(keyring, stored.refreshToken)
		});
	} catch (e) {
		if (e instanceof SpotifyError && e.needsReauth) {
			write(db, { displayName: stored.displayName, refreshToken: null });
			cached = undefined;
		}
		throw e;
	}
	// Spotify may rotate the refresh token; keep the newest.
	if (t.refresh_token)
		write(db, {
			displayName: stored.displayName,
			refreshToken: sealRefreshToken(keyring, t.refresh_token)
		});
	cached = { token: t.access_token!, expiresAt: now + (t.expires_in ?? 3600) * 1000 };
	return cached.token;
}

/**
 * Calls the Spotify Web API as the household account. `path` starts with `/v1/...`.
 * A 401 refreshes the token once and retries; a revoked sign-in marks Spotify as needing reconnect.
 */
export async function spotifyFetch(
	path: string,
	init: RequestInit = {},
	deps: Deps = {}
): Promise<Response> {
	const f = deps.fetch ?? fetch;
	const send = async (force: boolean) => {
		const headers = new Headers(init.headers);
		headers.set('authorization', `Bearer ${await accessToken(deps, force)}`);
		return call(f, `${endpoints.api}${path}`, { ...init, headers });
	};
	const res = await send(false);
	if (res.status !== 401) return res;
	void res.body?.cancel();
	return send(true);
}
