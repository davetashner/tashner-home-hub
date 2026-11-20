import { getDb } from '#lib/server/db/index.js';
import { markMaintenanceDone } from '#lib/server/domain/maintenance.js';
import { handle, localDate, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Body: { date? } (YYYY-MM-DD, default the household's today). Records the task as done that day
 * and schedules the next one. The device sends the day it was tapped, so a replayed offline write
 * keeps it.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const date = body.date ?? localDate(Date.now());
	return handle(() => markMaintenanceDone(getDb(), event.params.id, date));
};
