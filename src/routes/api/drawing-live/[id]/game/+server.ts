import { error } from '@sveltejs/kit';
import { gameAction } from '#lib/server/domain/drawing-live.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Draw and guess (hub-t27j.10). Body: `{ author, action: 'start' | 'guess' | 'ping' | 'leave',
 * index? }`. Returns `{ game, word?, result? }`: the public round, the secret word only for the
 * drawer, and for a guess `right`, `wrong` or `ignored`. State changes are also relayed on the
 * `drawing` topic as `{ session, game }` (JSON of the public round, or `null` once it ends).
 */
export const POST: RequestHandler = async ({ request, params }) => {
	let body: unknown;
	try {
		body = JSON.parse((await request.text()).slice(0, 2_000));
	} catch {
		error(400, 'Expected a JSON object body');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		error(400, 'Expected a JSON object body');
	const b = body as Record<string, unknown>;
	return handle(() => gameAction(params.id, b.author, b));
};
