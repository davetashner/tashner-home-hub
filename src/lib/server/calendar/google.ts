import { createHash, randomBytes } from 'node:crypto';
import { expandAll } from '../domain/calendar/expand.js';
import { mapGoogleEvent, type GoogleEvent } from '../domain/calendar/google-map.js';
import type { NewEvent } from '../domain/calendar/ics-build.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	providerRegistry,
	type CalendarProvider,
	type CalendarSource,
	type EditFailure,
	type EventRef,
	type RemoteCalendar,
	type RemoteEvent,
	type Window
} from './provider.js';

/** Events read and write, plus the calendar list (events access alone cannot list calendars). */
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE = `${WRITE_SCOPE} https://www.googleapis.com/auth/calendar.calendarlist.readonly`;

/** True when a granted scope string lets the hub write events (an old `calendar.readonly` grant does not). */
export function hasWriteScope(scope: string | undefined): boolean {
	return (scope ?? '')
		.split(/\s+/)
		.some((s) => s === WRITE_SCOPE || s === 'https://www.googleapis.com/auth/calendar');
}
export const WRITE_SCOPE_MESSAGE =
	'Reconnect Google to add and edit events: this connection was only allowed to read the calendar.';
export const CHANGED_MESSAGE = 'This event changed on another device — check it and try again.';
export const RECURRING_MESSAGE = 'This event repeats. Edit this on your phone.';
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
		readonly needsReauth = false,
		/** Set when a write was refused for a reason the adult can act on. */
		readonly code?: EditFailure | 'scope'
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

export function authUrl(
	cfg: GoogleConfig,
	state: string,
	challenge: string,
	scope: string = SCOPE
): string {
	const u = new URL(endpoints.auth);
	u.search = new URLSearchParams({
		client_id: cfg.clientId,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope,
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
	scope?: string;
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
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; scope: string }> {
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
			expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
			scope: t.scope ?? ''
		};
	} catch (e) {
		// A used or expired code is invalid_grant too, but there is nothing to "reconnect" yet.
		if (e instanceof GoogleError && e.needsReauth)
			throw new GoogleError('That code was rejected or has expired. Start again');
		throw e;
	}
}

const aad = (sourceId: string) => `calendar_source:${sourceId}`;

/** `scope` is what Google granted at consent; connections made before write support have none. */
export function sealRefreshToken(
	keyring: Keyring,
	sourceId: string,
	refreshToken: string,
	scope?: string
): string {
	return encryptSecret(keyring, JSON.stringify({ refreshToken, scope }), aad(sourceId));
}

export function openGoogleCredentials(
	keyring: Keyring,
	source: Pick<CalendarSource, 'id' | 'credentials'>
): { refreshToken: string; scope?: string } {
	if (!source.credentials) throw new GoogleError('This Google account has no stored sign-in', true);
	return JSON.parse(decryptSecret(keyring, source.credentials, aad(source.id)));
}

/** Whether this stored connection may write events. False for old read-only grants. */
export function canWriteGoogle(keyring: Keyring, source: CalendarSource): boolean {
	try {
		return hasWriteScope(openGoogleCredentials(keyring, source).scope);
	} catch {
		return false;
	}
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
	/** Only set (false) when the account cannot add events here, e.g. a holiday calendar. */
	writable?: false;
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
				accessRole?: string;
			}>
		>(accessToken, '/users/me/calendarList', q);
		for (const c of r.items ?? [])
			out.push({
				externalId: c.id,
				name: c.summaryOverride || c.summary || c.id,
				selected: c.primary === true || c.selected === true,
				...(c.accessRole === 'reader' || c.accessRole === 'freeBusyReader'
					? { writable: false as const }
					: {})
			});
		pageToken = r.nextPageToken;
		if (!pageToken) break;
	}
	return out;
}

type GoogleBody = Record<string, unknown>;

/** The Google `start`/`end` pair for an event; PATCH sends nulls so a timed/all-day switch clears the other form. */
export function googleEventBody(e: NewEvent, patch: boolean): GoogleBody {
	const t = e.time;
	const clear = patch ? null : undefined;
	const when = t.allDay
		? {
				start: { date: t.startDate, dateTime: clear },
				end: { date: t.endDate, dateTime: clear }
			}
		: {
				start: { dateTime: new Date(t.startMs).toISOString(), date: clear },
				end: { dateTime: new Date(t.endMs).toISOString(), date: clear }
			};
	return {
		summary: e.title,
		location: e.location ?? clear,
		description: e.notes ?? clear,
		...when
	};
}

async function apiWrite(
	accessToken: string,
	method: 'POST' | 'PATCH' | 'DELETE',
	path: string,
	body?: GoogleBody,
	etag?: string
): Promise<GoogleEvent | null> {
	const res = await call(`${endpoints.api}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${accessToken}`,
			accept: 'application/json',
			...(body ? { 'content-type': 'application/json' } : {}),
			...(etag ? { 'if-match': etag } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (res.ok) return method === 'DELETE' ? null : ((await res.json()) as GoogleEvent);
	const detail = (await res.json().catch(() => null)) as {
		error?: { errors?: { reason?: string }[] };
	} | null;
	if (res.status === 401) throw new GoogleError(REAUTH_MESSAGE, true);
	if (res.status === 412) throw new GoogleError(CHANGED_MESSAGE, false, 'changed');
	if (
		res.status === 403 &&
		detail?.error?.errors?.some((x) => x.reason === 'insufficientPermissions')
	)
		throw new GoogleError(WRITE_SCOPE_MESSAGE, false, 'scope');
	if (res.status === 403)
		throw new GoogleError('Google does not let this account change that calendar');
	if (res.status === 404 || res.status === 410) {
		if (method === 'DELETE') return null; // already gone counts as deleted
		throw new GoogleError(CHANGED_MESSAGE, false, 'changed');
	}
	throw new GoogleError(`Google answered ${res.status}`);
}

const DAY = 86_400_000;
const eventPath = (calendarId: string, uid: string) =>
	`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(uid)}`;

/**
 * Reads the event fresh and checks it is still the plain, unchanged event the hub showed. The
 * returned etag goes in `If-Match` so a change landing between this read and the write is a 412.
 */
async function locate(token: string, ref: EventRef): Promise<{ etag: string }> {
	const q = new URLSearchParams();
	let g: GoogleEvent & { etag?: string };
	try {
		g = await apiGet(token, eventPath(ref.calendarId, ref.uid), q);
	} catch (e) {
		if (e instanceof GoogleError && !e.needsReauth && /\(404\)/.test(e.message))
			throw new GoogleError(CHANGED_MESSAGE, false, 'changed');
		throw e;
	}
	if (g.recurrence?.length || g.recurringEventId)
		throw new GoogleError(RECURRING_MESSAGE, false, 'recurring');
	const w = {
		start: ref.cached.startsAt - DAY,
		end: Math.max(ref.cached.endsAt, ref.cached.startsAt + 1) + DAY
	};
	const mapped = mapGoogleEvent(g);
	const now =
		mapped && expandAll([mapped], w).find((i) => i.externalId === `${ref.uid}::${ref.instance}`);
	const c = ref.cached;
	if (
		!now ||
		!g.etag ||
		now.title !== c.title ||
		now.startsAt !== c.startsAt ||
		now.endsAt !== c.endsAt ||
		now.allDay !== c.allDay ||
		now.location !== c.location ||
		now.notes !== c.notes
	)
		throw new GoogleError(CHANGED_MESSAGE, false, 'changed');
	return { etag: g.etag };
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
			refresh_token: openGoogleCredentials(keyring, source).refreshToken
		});
		cached = { token: t.access_token!, expiresAt: now() + (t.expires_in ?? 3600) * 1000 };
		return cached.token;
	}

	/** A token for a write; refuses up front when the stored grant is read-only. */
	async function writeToken(): Promise<string> {
		if (!canWriteGoogle(keyring, source))
			throw new GoogleError(WRITE_SCOPE_MESSAGE, false, 'scope');
		return accessToken();
	}

	return {
		async createEvent(calendarId, event) {
			const token = await writeToken();
			const made = await apiWrite(
				token,
				'POST',
				`/calendars/${encodeURIComponent(calendarId)}/events`,
				googleEventBody(event, false)
			);
			if (!made?.id) throw new GoogleError('Google did not confirm the new event');
			return { uid: made.id };
		},
		async updateEvent(ref, event) {
			const token = await writeToken();
			const { etag } = await locate(token, ref);
			await apiWrite(
				token,
				'PATCH',
				eventPath(ref.calendarId, ref.uid),
				googleEventBody(event, true),
				etag
			);
		},
		async deleteEvent(ref) {
			const token = await writeToken();
			const { etag } = await locate(token, ref);
			await apiWrite(token, 'DELETE', eventPath(ref.calendarId, ref.uid), undefined, etag);
		},
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
