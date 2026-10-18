import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createChore, listChores, validKind, type ChoreInput } from '#lib/server/domain/chores.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Query: `archived=1` includes archived chores; `kind=star_job|habit` filters. */
export const GET: RequestHandler = ({ url }) =>
	handle(() =>
		listChores(getDb(), {
			includeArchived: url.searchParams.get('archived') === '1',
			kind: url.searchParams.has('kind') ? validKind(url.searchParams.get('kind')) : undefined
		})
	);

export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() => createChore(getDb(), body as unknown as ChoreInput));
};
