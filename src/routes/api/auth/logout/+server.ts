import { json } from '@sveltejs/kit';
import { clearSession, resolveAdult, revokeSessions } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

/** Locking ends this adult's access on every device: copied cookies die with the epoch bump. */
export const POST: RequestHandler = (event) => {
	const adult = resolveAdult(event);
	if (adult) revokeSessions(adult.id);
	clearSession(event);
	return json({ ok: true });
};
