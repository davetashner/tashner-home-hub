import { getDb } from '#lib/server/db/index.js';
import { createMaintenance, listMaintenance } from '#lib/server/domain/maintenance.js';
import { handle, localDate, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Every maintenance task, soonest due first, with the household's today so the screen can tell
 * what is due without trusting the browser's clock. Open to every device, like the lists.
 */
export const GET: RequestHandler = () =>
	handle(() => ({ today: localDate(Date.now()), tasks: listMaintenance(getDb()) }));

/**
 * Body: { title, intervalMonths? (blank = as needed), nextDue?, lastDone?, estTime?, notes? }.
 * Without nextDue, it is worked out from lastDone and the frequency. Anyone may add.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const res = handle(() => createMaintenance(getDb(), body));
	return new Response(res.body, { status: 201, headers: res.headers });
};
