import { json } from '@sveltejs/kit';
import { DISPLAY_SCOPE, RateLimiter, bearerToken } from '#lib/domain/siri.js';
import { parseRemoteState } from '#lib/domain/ha-display.js';
import { getDb } from '#lib/server/db/index.js';
import { verifyToken } from '#lib/server/domain/api-tokens.js';
import { recordPowerEvent } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/** Per-token ceiling, and a shared ceiling on rejected attempts (one process, LAN only). */
const remoteLimiter = new RateLimiter(60, 60_000);
const failureLimiter = new RateLimiter(20, 60_000);

const respond = (body: Record<string, unknown>, status: number) =>
	json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Home Assistant wakes or sleeps the wall (SLP-7). Body: { state: "wake" | "sleep" }.
 * Authorization: Bearer <token with the display:power scope>; cookies are never consulted.
 * It records the same power event as the on-wall buttons, so the Pi agent just polls as usual.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = bearerToken(request.headers.get('authorization'));
	const token = secret ? verifyToken(getDb(), secret) : null;
	if (!token) {
		if (!failureLimiter.take('bad')) return respond({ ok: false, error: 'rate_limited' }, 429);
		return respond({ ok: false, error: 'unauthorized' }, 401);
	}
	if (!token.scopes.includes(DISPLAY_SCOPE)) return respond({ ok: false, error: 'forbidden' }, 403);
	if (!remoteLimiter.take(token.id)) return respond({ ok: false, error: 'rate_limited' }, 429);
	const body: unknown = await request.json().catch(() => null);
	const state = parseRemoteState(body);
	if (!state)
		return respond(
			{ ok: false, error: 'invalid', message: 'state must be "wake" or "sleep"' },
			400
		);
	const power = recordPowerEvent(state);
	return respond({ ok: true, state, power: power.power, reason: power.reason }, 200);
};
