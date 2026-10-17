import { getDb } from '#lib/server/db/index.js';
import { addItem } from '#lib/server/domain/lists.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: { text }. Anyone may add. */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() => addItem(getDb(), event.params.id, body.text));
	return new Response(res.body, { status: 201, headers: res.headers });
};
