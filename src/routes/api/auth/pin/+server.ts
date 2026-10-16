import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { issueSession, pinLimiter } from '#lib/server/auth.js';
import { verifyPin } from '#lib/server/domain/pin.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => null)) as {
		memberId?: unknown;
		pin?: unknown;
		remember?: unknown;
	} | null;
	if (!body || typeof body.memberId !== 'string' || typeof body.pin !== 'string') {
		error(400, 'memberId and pin are required');
	}
	const remember = body.remember === true;

	// Keyed by client address and member so one locked-out child cannot lock the parents out.
	let address = 'unknown';
	try {
		address = event.getClientAddress();
	} catch {
		/* keep fallback */
	}
	const key = `${address}|${body.memberId}`;
	const now = Date.now();
	const waitMs = pinLimiter.remainingMs(key, now);
	if (waitMs > 0) {
		return json(
			{ message: 'Too many wrong attempts. Try again later.', retryAfterMs: waitMs },
			{ status: 429, headers: { 'retry-after': String(Math.ceil(waitMs / 1000)) } }
		);
	}

	const member = getDb()
		.select()
		.from(schema.members)
		.where(eq(schema.members.id, body.memberId))
		.get();
	const ok = member?.role === 'adult' && verifyPin(body.pin, member.pinHash);
	if (!ok) {
		const lockMs = pinLimiter.recordFailure(key, now);
		return json(
			{ message: 'Wrong PIN.', ...(lockMs > 0 ? { retryAfterMs: lockMs } : {}) },
			{ status: 401 }
		);
	}
	pinLimiter.recordSuccess(key);
	issueSession(event, member.id, remember);
	return json({ ok: true, member: { id: member.id, name: member.name } });
};
