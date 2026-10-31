import { error } from '@sveltejs/kit';
import { MAX_EVENT_BODY, postEvent } from '#lib/server/domain/drawing-live.js';
import { handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Body: `{ author, event }` where event is `{ type: 'add', item }` (one-item drawing JSON, see
 * `#lib/domain/drawing-live.js`) or `{ type: 'undo' }`. Returns the sequenced entry, which is
 * also relayed to every subscriber of the `drawing` topic. Bodies over MAX_EVENT_BODY get 413.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_EVENT_BODY) error(413, 'Event too large');
	const text = await request.text();
	if (text.length > MAX_EVENT_BODY) error(413, 'Event too large');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Expected a JSON object body');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		error(400, 'Expected a JSON object body');
	const b = body as Record<string, unknown>;
	return handle(() => postEvent(params.id, b.author, b.event));
};
