import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteRoutine, updateRoutine } from '#lib/server/domain/routines.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Send a JSON content-type with the DELETE: SvelteKit's CSRF check rejects bodyless writes. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteRoutine(getDb(), event.params.id));
};

/** Body: { memberId?, name, windowStart?, windowEnd?, steps: [{ label, icon }] }. Replaces the steps. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() =>
		updateRoutine(getDb(), event.params.id, {
			memberId: body.memberId as string | undefined,
			name: body.name,
			windowStart: body.windowStart,
			windowEnd: body.windowEnd,
			steps: body.steps
		})
	);
};
