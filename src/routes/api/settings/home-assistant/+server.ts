import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { disconnect, readConfig, saveConnection } from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Adult only. The saved address and picks; the token is never sent back. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(readConfig());
};

/** Adult only. Body: { baseUrl, token? }. A blank token keeps the saved one. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return json(await haRoute(() => saveConnection({ baseUrl: body.baseUrl, token: body.token })));
};

/** Adult only. Forgets the address, token and picks. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	disconnect();
	return json(readConfig());
};
