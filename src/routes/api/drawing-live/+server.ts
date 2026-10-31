import { error, json } from '@sveltejs/kit';
import { openSession } from '#lib/server/domain/drawing-live.js';
import { LedgerError } from '#lib/server/domain/ledger.js';
import type { RequestHandler } from './$types';

/**
 * Opens a live shared board session and returns `{ id, seq }`; the id is the code another
 * device joins with (`GET /api/drawing-live/<id>`). Open to every LAN device like the rest of
 * the drawing API: kids draw too. Send a JSON content-type (body `{}`).
 */
export const POST: RequestHandler = () => {
	try {
		return json(openSession(), { status: 201 });
	} catch (e) {
		if (e instanceof LedgerError) error(409, e.message);
		throw e;
	}
};
