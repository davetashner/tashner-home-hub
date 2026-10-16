import { json } from '@sveltejs/kit';
import { clearSession } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	clearSession(event);
	return json({ ok: true });
};
