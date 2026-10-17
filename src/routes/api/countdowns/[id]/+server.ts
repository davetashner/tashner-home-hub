import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteCountdown, updateCountdown } from '#lib/server/domain/countdowns.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of { title, targetDate, icon }. */
export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	return handle(() =>
		updateCountdown(getDb(), event.params.id, {
			title: body.title as string | undefined,
			targetDate: body.targetDate as string | undefined,
			icon: body.icon as string | null | undefined
		})
	);
};

/** Send a JSON content-type (body `{}`): SvelteKit's CSRF check refuses DELETEs without one. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteCountdown(getDb(), event.params.id));
};
