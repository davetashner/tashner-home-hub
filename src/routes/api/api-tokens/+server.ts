import { requireAdult } from '#lib/server/auth.js';
import { getDb } from '#lib/server/db/index.js';
import { createToken, listTokens } from '#lib/server/domain/api-tokens.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => listTokens(getDb()));
};

/** Body: { name, scopes }. The plaintext token is in this response only. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const res = handle(() => createToken(getDb(), body.name, body.scopes));
	return new Response(res.body, {
		status: 201,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
};
