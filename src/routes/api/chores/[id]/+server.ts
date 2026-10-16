import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { updateChore, type ChoreInput } from '#lib/server/domain/chores.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => updateChore(getDb(), event.params.id, body as Partial<ChoreInput>));
};
