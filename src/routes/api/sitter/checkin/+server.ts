import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { submitCheckin } from '#lib/server/domain/sitter.js';
import { notifySitterCheckin } from '#lib/server/notify.js';
import { readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * From the wall's sitter view. Body: { kind: 'in-bed' | 'all-good' | 'call-me' }. No adult session
 * needed, like the other wall reads. Only while a sitter session is active (409 otherwise), and
 * each kind at most once a minute (429). Notifies the parents. Answers { ok: true, at }.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const out = submitCheckin(getDb(), body.kind, Date.now());
	if (!out.ok) {
		const headers = out.retryAfterMs
			? { 'retry-after': String(Math.ceil(out.retryAfterMs / 1000)) }
			: undefined;
		return json(
			{ message: out.message, ...(out.retryAfterMs ? { retryAfterMs: out.retryAfterMs } : {}) },
			{ status: out.status, headers }
		);
	}
	notifySitterCheckin(getDb(), out.sitterName, out.kind);
	return json({ ok: true, at: out.at });
};
