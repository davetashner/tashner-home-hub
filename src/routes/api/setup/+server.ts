import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { issueSession, pinLimiter } from '#lib/server/auth.js';
import { completeSetup, needsSetup, SetupError } from '#lib/server/domain/setup.js';
import { markSetupDone } from '#lib/server/setup-state.js';
import { body, handle } from '#lib/server/members-api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ needsSetup: needsSetup(getDb()) });

export const POST: RequestHandler = async (event) => {
	const data = await body(event);

	let address = 'unknown';
	try {
		address = event.getClientAddress();
	} catch {
		/* keep fallback */
	}
	const key = `${address}|setup`;
	const now = Date.now();
	const waitMs = pinLimiter.remainingMs(key, now);
	if (waitMs > 0) {
		return json(
			{ message: 'Too many attempts. Try again later.', retryAfterMs: waitMs },
			{ status: 429, headers: { 'retry-after': String(Math.ceil(waitMs / 1000)) } }
		);
	}

	let member;
	try {
		member = handle(() =>
			completeSetup(getDb(), {
				name: data.name as string,
				color: data.color as string,
				avatar: data.avatar as string | null | undefined,
				pin: data.pin as string
			})
		);
	} catch (e) {
		if (e instanceof SetupError) {
			if (e.code === 'validation') pinLimiter.recordFailure(key, now);
			error(e.code === 'already_setup' ? 409 : 400, e.message);
		}
		pinLimiter.recordFailure(key, now);
		throw e;
	}
	markSetupDone();
	pinLimiter.recordSuccess(key);
	issueSession(event, member.id, data.remember === true);
	return json({ ok: true, member: { id: member.id, name: member.name } }, { status: 201 });
};
