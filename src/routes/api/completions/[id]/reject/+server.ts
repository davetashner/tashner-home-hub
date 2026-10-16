import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { rejectCompletion } from '#lib/server/domain/ledger.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Optional body: { note }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body =
		event.request.headers.get('content-length') === '0' ? {} : await readJson(event.request);
	const note = body.note === undefined ? undefined : str(body.note, 'note');
	return handle(() => rejectCompletion(getDb(), event.params.id, { note }));
};
