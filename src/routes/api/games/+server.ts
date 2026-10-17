import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createGame, listGames } from '#lib/server/domain/games.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** The ordered game list. Anyone may read it: the kids' Games tab uses it. */
export const GET: RequestHandler = ({ url }) => handle(() => listGames(getDb(), url.origin));

/** Body: { title, url (https), image? (https) }. */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	// The hub's own origin is never a game: it would run as the hub inside the frame.
	const res = handle(() => createGame(getDb(), body, event.url.origin));
	return new Response(res.body, { status: 201, headers: res.headers });
};
