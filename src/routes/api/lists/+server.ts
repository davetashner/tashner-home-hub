import { getDb } from '#lib/server/db/index.js';
import { createList, listAll } from '#lib/server/domain/lists.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Every list with its items. Open to every device, like a note on the fridge. */
export const GET: RequestHandler = () => handle(() => listAll(getDb()));

/** Body: { title }. */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() => createList(getDb(), body.title));
	return new Response(res.body, { status: 201, headers: res.headers });
};
