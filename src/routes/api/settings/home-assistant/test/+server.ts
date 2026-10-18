import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { testConnection } from '#lib/server/home-assistant/index.js';
import { haRoute } from '#lib/server/home-assistant/respond.js';
import type { RequestHandler } from './$types';

/** Adult only. Body: { baseUrl?, token? } to try unsaved values; empty body tests the saved ones. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const typed =
		body.baseUrl || body.token ? { baseUrl: body.baseUrl, token: body.token } : undefined;
	return json(await haRoute(() => testConnection(typed)));
};
