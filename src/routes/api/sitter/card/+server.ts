import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { getKeyring } from '#lib/server/keys.js';
import { readCard, saveCard } from '#lib/server/domain/sitter.js';
import { readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Adult only: the whole info card, decrypted. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(readCard(getDb(), getKeyring()));
};

/** Adult only. Body: the whole card (see SitterCard). Replaces what was stored. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	return json(saveCard(getDb(), getKeyring(), await readJson(event.request)));
};
