import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { endSession, extendSession } from '#lib/server/domain/sitter.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Adult only. Body: { end: true } ends it now (or cancels a scheduled one); { endAt } extends it. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const id = event.params.id;
	return handle(() =>
		body.end === true
			? endSession(getDb(), id, Date.now())
			: extendSession(getDb(), id, body.endAt, Date.now())
	);
};
