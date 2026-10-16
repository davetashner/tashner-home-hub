import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { getKeyring } from '#lib/server/keys.js';
import { PinLimiter } from '#lib/server/domain/pin-limiter.js';
import {
	deriveSessionKey,
	newSession,
	refreshSession,
	shouldRefresh,
	signSession,
	verifySession,
	type SessionPayload
} from '#lib/server/domain/session.js';

export const SESSION_COOKIE = 'hub_session';

/** Shared across requests: one server process. */
export const pinLimiter = new PinLimiter();

function sessionKey(): Buffer {
	const ring = getKeyring();
	const master = ring.keys.get(ring.activeKeyId);
	if (!master) throw new Error('Active key missing from keyring');
	return deriveSessionKey(master);
}

type CookieEvent = { cookies: Cookies; url: URL };

function writeCookie(event: CookieEvent, payload: SessionPayload): void {
	event.cookies.set(SESSION_COOKIE, signSession(sessionKey(), payload), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		// LAN http would silently drop a Secure cookie; only mark it Secure over https.
		secure: event.url.protocol === 'https:',
		maxAge: Math.ceil(payload.ttl / 1000)
	});
}

/** Starts an adult session. `remember` = personal phone (30 days); otherwise shared wall screen (2 min idle). */
export function issueSession(event: CookieEvent, memberId: string, remember: boolean): void {
	writeCookie(event, newSession(memberId, remember, Date.now()));
}

export function clearSession(event: Pick<RequestEvent, 'cookies'>): void {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * Resolves the session cookie to an adult (still existing, still an adult, still has a PIN)
 * and slides its expiry. Passive background GETs under /api do not count as activity,
 * so a wall screen polling in the background still times out.
 */
export function resolveAdult(event: RequestEvent): App.Locals['adult'] {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const now = Date.now();
	const session = verifySession(sessionKey(), token, now);
	const member = session
		? getDb().select().from(schema.members).where(eq(schema.members.id, session.m)).get()
		: undefined;
	if (!session || !member || member.role !== 'adult' || !member.pinHash) {
		clearSession(event);
		return null;
	}
	const passive = event.request.method === 'GET' && event.url.pathname.startsWith('/api/');
	if (!passive && shouldRefresh(session, now)) writeCookie(event, refreshSession(session, now));
	return { id: member.id, name: member.name };
}

export function currentAdult(event: Pick<RequestEvent, 'locals'>): App.Locals['adult'] {
	return event.locals?.adult ?? null;
}

/** Whether the caller holds an adult session, without rejecting (e.g. undo window rules). */
export function isAdult(event: Pick<RequestEvent, 'locals'>): boolean {
	return currentAdult(event) !== null;
}

/** Guards adult-only endpoints. Throws 401 when no valid adult PIN session exists. */
export function requireAdult(event: RequestEvent): NonNullable<App.Locals['adult']> {
	const adult = currentAdult(event);
	if (!adult) error(401, 'Adult PIN required');
	return adult;
}
