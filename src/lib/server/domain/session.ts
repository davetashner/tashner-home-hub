/**
 * Stateless signed session cookies (no DB table). Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Wall-screen sessions (no "remember") expire after 2 minutes of inactivity; remembered phone sessions after 30 days.
 * Activity re-issues the token with a fresh `exp` (see `shouldRefresh`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WALL_IDLE_MS = 2 * 60_000;
export const PHONE_TTL_MS = 30 * 24 * 60 * 60_000;

export interface SessionPayload {
	/** Member id. */
	m: string;
	/** Issued-at, epoch ms. */
	iat: number;
	/** Expiry, epoch ms. */
	exp: number;
	/** Sliding lifetime, ms. */
	ttl: number;
	/** Member's session epoch at issue time; a session is void once the member's epoch moves on. Absent = 0. */
	e: number;
}

/** Derives the cookie-signing key from the app keyring's master key (domain-separated). */
export function deriveSessionKey(master: Buffer): Buffer {
	return createHmac('sha256', master).update('hub-session-v1').digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (key: Buffer, body: string) => createHmac('sha256', key).update(body).digest();

export function newSession(
	memberId: string,
	remember: boolean,
	now: number,
	epoch = 0
): SessionPayload {
	const ttl = remember ? PHONE_TTL_MS : WALL_IDLE_MS;
	return { m: memberId, iat: now, exp: now + ttl, ttl, e: epoch };
}

export function signSession(key: Buffer, payload: SessionPayload): string {
	const body = b64(JSON.stringify(payload));
	return `${body}.${b64(mac(key, body))}`;
}

/** Returns the payload if the signature is valid and the session has not expired, else null. */
export function verifySession(key: Buffer, token: string, now: number): SessionPayload | null {
	const [body, sig, ...rest] = token.split('.');
	if (!body || !sig || rest.length > 0) return null;
	const given = Buffer.from(sig, 'base64url');
	const expected = mac(key, body);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		const p = JSON.parse(
			Buffer.from(body, 'base64url').toString('utf8')
		) as Partial<SessionPayload>;
		if (
			typeof p.m !== 'string' ||
			typeof p.iat !== 'number' ||
			typeof p.exp !== 'number' ||
			typeof p.ttl !== 'number'
		) {
			return null;
		}
		// Cookies minted before epochs existed carry no `e`; they count as epoch 0.
		const e = typeof p.e === 'number' ? p.e : 0;
		return p.exp > now ? { m: p.m, iat: p.iat, exp: p.exp, ttl: p.ttl, e } : null;
	} catch {
		return null;
	}
}

/** Re-issue only when meaningfully old, to avoid a Set-Cookie on every request. */
export function shouldRefresh(p: SessionPayload, now: number): boolean {
	return now - p.iat > Math.min(p.ttl / 10, 5_000);
}

export function refreshSession(p: SessionPayload, now: number): SessionPayload {
	return { ...p, iat: now, exp: now + p.ttl };
}

/** Only same-origin absolute paths are valid redirect targets (no open redirects). */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
	return next;
}
