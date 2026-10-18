import { getDb } from '#lib/server/db/index.js';
import { listAll } from '#lib/server/domain/lists.js';
import { authenticate, reply } from '#lib/server/siri.js';
import type { RequestHandler } from './$types';

/** The list names, for Shortcuts' "Choose from List". Needs the lists:add scope. */
export const GET: RequestHandler = ({ request }) => {
	const auth = authenticate(request, 'lists:add');
	if ('response' in auth) return auth.response;
	const lists = listAll(getDb()).map((l) => l.title);
	return reply({ ok: true, lists, speak: `The lists are ${lists.join(', ')}.` });
};
