import { ITEM_TEXT_MAX, cleanText } from '#lib/domain/lists.js';
import { matchName, spokenList } from '#lib/domain/siri.js';
import { getDb } from '#lib/server/db/index.js';
import { addItem, listAll } from '#lib/server/domain/lists.js';
import { authenticate, badRequest, readBody, reply, spokenError } from '#lib/server/siri.js';
import type { RequestHandler } from './$types';

/** Body: { list, item }. Adds an item to the list the spoken name matches. */
export const POST: RequestHandler = async ({ request }) => {
	const auth = authenticate(request, 'lists:add');
	if ('response' in auth) return auth.response;
	const body = await readBody(request);
	if (!body) return badRequest('I could not read that request.');
	const item = cleanText(body.item, ITEM_TEXT_MAX);
	if (!item) return badRequest(`Tell me what to add, in up to ${ITEM_TEXT_MAX} characters.`);
	const db = getDb();
	const all = listAll(db);
	const names = all.map((l) => l.title);
	const hit = matchName(body.list, all, (l) => l.title);
	if (hit.kind === 'none')
		return reply({
			ok: false,
			lists: names,
			speak: `I could not find that list. The lists are ${spokenList(names)}.`
		});
	if (hit.kind === 'ambiguous')
		return reply({
			ok: false,
			lists: names,
			speak: `Which list? ${spokenList(hit.options.map((l) => l.title))}.`
		});
	try {
		addItem(db, hit.value.id, item);
	} catch (e) {
		return spokenError(e);
	}
	return reply({
		ok: true,
		list: hit.value.title,
		item,
		speak: `Added ${item} to ${hit.value.title}.`
	});
};
