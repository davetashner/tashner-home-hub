import { createHash, randomBytes } from 'node:crypto';
import { mapGoogleEvent, type GoogleEvent } from '../domain/calendar/google-map.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	providerRegistry,
	type CalendarProvider,
	type CalendarSource,
	type RemoteCalendar,
	type RemoteEvent,
	type Window
} from './provider.js';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
/** Google accepts any port on a loopback address for Desktop clients; nothing listens here. */
export const REDIRECT_URI = 'http://127.0.0.1:9004';
export const REAUTH_MESSAGE = `This Google account needs to be reconnected: Google no longer accepts the saved sign-in. Reconnect it from the admin screen.`;
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 40;

/** Overridable so tests can point at a local mock server. */
export const endpoints = {
	auth: 'https://accounts.google.com/o/oauth2/v2/auth',
	token: 'https://oauth2.googleapis.com/token',
	api: 'https://www.googleapis.com/calendar/v3'
};

/** A failure with a message that is safe to show an adult (never contains tokens or secrets). */
export class GoogleError extends Error {
	constructor(
		message: string,
		readonly needsReauth = false
	) {
		super(message);
		this.name = 'GoogleError';
	}
}

export interface GoogleConfig {
	clientId: string;
	clientSecret: string;
}

export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
	const clientId = env.HUB_GOOGLE_CLIENT_ID?.trim();
	const clientSecret = env.HUB_GOOGLE_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret)
		throw new GoogleError(
			'Google is not set up yet: add HUB_GOOGLE_CLIENT_ID and HUB_GOOGLE_CLIENT_SECRET to the hub .env and restart it'
		);
	return { clientId, clientSecret };
}

const b64url = (b: Buffer) => b.toString('base64url');

export function createPkce(): { verifier: string; challenge: string } {
	const verifier = b64url(randomBytes(48));
	return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function authUrl(cfg: GoogleConfig, state: string, challenge: string): string {
	const u = new URL(endpoints.auth);
	u.search = new URLSearchParams({
		client_id: cfg.clientId,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: SCOPE,
		access_type: 'offline',
		prompt: 'consent',
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256'
	}).toString();
	return u.href;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
}

async function call(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	} catch {
		throw new GoogleError('Could not reach Google');
	}
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
	const res = await call(endpoints.token, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(params)
	});
	const body = (await res.json().catch(() => ({}))) as TokenResponse;
	if (res.ok && body.access_token) return body;
	if (body.error === 'invalid_grant') throw new GoogleError(REAUTH_MESSAGE, true);
	if (body.error === 'invalid_client')
		throw new GoogleError('Google rejected the client id or secret in the hub .env');
	throw new GoogleError(`Google sign-in failed (${res.status})`);
}

/** Exchanges the pasted authorization code for tokens. Requires a refresh token. */
export async function exchangeCode(
	cfg: GoogleConfig,
	code: string,
	verifier: string
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number }> {
	try {
		const t = await tokenRequest({
			grant_type: 'authorization_code',
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI
		});
		if (!t.refresh_token)
			throw new GoogleError(
				'Google did not return a long-lived sign-in. Remove the hub from your Google account permissions and try again'
			);
		return {
			refreshToken: t.refresh_token,
			accessToken: t.access_token!,
			expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000
		};
	} catch (e) {
		// A used or expired code is invalid_grant too, but there is nothing to "reconnect" yet.
		if (e instanceof GoogleError && e.needsReauth)
			throw new GoogleError('That code was rejected or has expired. Start again');
		throw e;
	}
}

const aad = (sourceId: string) => `calendar_source:${sourceId}`;

export function sealRefreshToken(keyring: Keyring, sourceId: string, refreshToken: string): string {
	return encryptSecret(keyring, JSON.stringify({ refreshToken }), aad(sourceId));
}

function openRefreshToken(keyring: Keyring, source: Pick<CalendarSource, 'id' | 'credentials'>) {
	if (!source.credentials) throw new GoogleError('This Google account has no stored sign-in', true);
	return (
		JSON.parse(decryptSecret(keyring, source.credentials, aad(source.id))) as {
			refreshToken: string;
		}
	).refreshToken;
}

interface ApiList<T> {
	items?: T[];
	nextPageToken?: string;
}

async function apiGet<T>(accessToken: string, path: string, query: URLSearchParams): Promise<T> {
	const res = await call(`${endpoints.api}${path}?${query}`, {
		headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
	});
	if (res.ok) return (await res.json()) as T;
	void res.body?.cancel();
	if (res.status === 401) throw new GoogleError(REAUTH_MESSAGE, true);
	if (res.status === 403 || res.status === 404)
		throw new GoogleError(`Google denied access to that calendar (${res.status})`);
	throw new GoogleError(`Google answered ${res.status}`);
}

export interface DiscoveredCalendar extends RemoteCalendar {
	selected: boolean;
}

export async function listCalendarsWithToken(accessToken: string): Promise<DiscoveredCalendar[]> {
	const out: DiscoveredCalendar[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250' });
		if (pageToken) q.set('pageToken', pageToken);
		const r = await apiGet<
			ApiList<{
				id: string;
				summary?: string;
				summaryOverride?: string;
				primary?: boolean;
				selected?: boolean;
			}>
		>(accessToken, '/users/me/calendarList', q);
		for (const c of r.items ?? [])
			out.push({
				externalId: c.id,
				name: c.summaryOverride || c.summary || c.id,
				selected: c.primary === true || c.selected === true
			});
		pageToken = r.nextPageToken;
		if (!pageToken) break;
	}
	return out;
}

export function createGoogleProvider(
	source: CalendarSource,
	deps: { keyring?: Keyring; config?: GoogleConfig; now?: () => number } = {}
): CalendarProvider {
	const keyring = deps.keyring ?? getKeyring();
	const now = deps.now ?? Date.now;
	let cached: { token: string; expiresAt: number } | undefined;

	async function accessToken(): Promise<string> {
		if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
		const cfg = deps.config ?? googleConfig();
		const t = await tokenRequest({
			grant_type: 'refresh_token',
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
			refresh_token: openRefreshToken(keyring, source)
		});
		cached = { token: t.access_token!, expiresAt: now() + (t.expires_in ?? 3600) * 1000 };
		return cached.token;
	}

	return {
		async listCalendars() {
			return listCalendarsWithToken(await accessToken());
		},
		async fetchEvents(calendarId: string, window: Window): Promise<RemoteEvent[]> {
			const token = await accessToken();
			const out: RemoteEvent[] = [];
			let pageToken: string | undefined;
			for (let page = 0; page < MAX_PAGES; page++) {
				const q = new URLSearchParams({
					singleEvents: 'false',
					showDeleted: 'true',
					maxResults: '250',
					timeMin: new Date(window.start).toISOString(),
					timeMax: new Date(window.end).toISOString()
				});
				if (pageToken) q.set('pageToken', pageToken);
				const r = await apiGet<ApiList<GoogleEvent>>(
					token,
					`/calendars/${encodeURIComponent(calendarId)}/events`,
					q
				);
				for (const g of r.items ?? []) {
					const e = mapGoogleEvent(g);
					if (e) out.push(e);
				}
				pageToken = r.nextPageToken;
				if (!pageToken) break;
			}
			return out;
		}
	};
}

providerRegistry.google = (source) => createGoogleProvider(source);
