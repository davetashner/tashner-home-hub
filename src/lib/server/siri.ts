/** Shared plumbing for the /api/siri/* routes: bearer auth, scope check, rate limit, spoken errors. */
import { json } from '@sveltejs/kit';
import { RateLimiter, bearerToken, type SiriScope } from '#lib/domain/siri.js';
import { getDb } from '#lib/server/db/index.js';
import { verifyToken, type TokenView } from '#lib/server/domain/api-tokens.js';
import { LedgerError } from '#lib/server/domain/ledger.js';

/** 30 requests a minute per token; shared across requests (one server process). */
export const siriLimiter = new RateLimiter(30, 60_000);

/** A spoken reply. Status stays 200 for "I could not find that" so Shortcuts can still read `speak`. */
export const reply = (
	body: { ok: boolean; speak: string } & Record<string, unknown>,
	status = 200
) => json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Authenticates a Siri request. Only an Authorization bearer header counts: cookies and sessions
 * are never consulted or created. Returns the token, or the error Response to send.
 */
export function authenticate(
	request: Request,
	scope: SiriScope | null
): { token: TokenView } | { response: Response } {
	const secret = bearerToken(request.headers.get('authorization'));
	const token = secret ? verifyToken(getDb(), secret) : null;
	if (!token)
		return {
			response: reply(
				{
					ok: false,
					speak: 'The hub did not accept this shortcut. Ask a grown-up to make a new one.'
				},
				401
			)
		};
	if (!siriLimiter.take(token.id))
		return {
			response: reply(
				{ ok: false, speak: 'That is too many requests. Try again in a minute.' },
				429
			)
		};
	if (scope && !token.scopes.includes(scope))
		return {
			response: reply({ ok: false, speak: 'This shortcut is not allowed to do that.' }, 403)
		};
	return { token };
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body: unknown = await request.json();
		if (body && typeof body === 'object' && !Array.isArray(body))
			return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	return null;
}

export const badRequest = (speak: string) => reply({ ok: false, speak }, 400);

/** Turns a domain validation error into a spoken 400; rethrows anything else. */
export function spokenError(e: unknown): Response {
	if (e instanceof LedgerError && e.code === 'invalid') return badRequest(e.message);
	throw e;
}
