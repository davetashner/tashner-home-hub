import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { pinLimiter } from '#lib/server/auth.js';
import { getKeyring } from '#lib/server/keys.js';
import { checkSitterPin, readCard } from '#lib/server/domain/sitter.js';
import { readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Open to the wall. Body: { pin }. Right PIN during an active session: { ok: true, session, card }.
 * Wrong PIN, no PIN set, or no active session: 401. Rate limited per client like the adult PINs.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	let address = 'unknown';
	try {
		address = event.getClientAddress();
	} catch {
		/* keep fallback */
	}
	const key = `${address}|sitter`;
	const now = Date.now();
	const waitMs = pinLimiter.remainingMs(key, now);
	if (waitMs > 0) {
		return json(
			{ message: 'Too many wrong attempts. Try again later.', retryAfterMs: waitMs },
			{ status: 429, headers: { 'retry-after': String(Math.ceil(waitMs / 1000)) } }
		);
	}
	const session = checkSitterPin(getDb(), body.pin, now);
	if (!session) {
		const lockMs = pinLimiter.recordFailure(key, now);
		return json(
			{ message: 'Wrong PIN.', ...(lockMs > 0 ? { retryAfterMs: lockMs } : {}) },
			{ status: 401 }
		);
	}
	pinLimiter.recordSuccess(key);
	return json({ ok: true, session, card: readCard(getDb(), getKeyring()) });
};
