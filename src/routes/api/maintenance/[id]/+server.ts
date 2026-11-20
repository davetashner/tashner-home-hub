import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteMaintenance, updateMaintenance } from '#lib/server/domain/maintenance.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Body: any of the POST fields; null clears an optional one. Anyone may fix a date. */
export const PATCH: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	return handle(() => updateMaintenance(getDb(), event.params.id, body));
};

/** Grown-ups only. Send a JSON content-type (body `{}`) to pass SvelteKit's CSRF check. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	return handle(() => deleteMaintenance(getDb(), event.params.id));
};
