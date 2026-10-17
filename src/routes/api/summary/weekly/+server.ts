import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { weeklySummary } from '#lib/server/domain/weekly-summary.js';
import { dateStr, handle } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Adults: the weekly summary (CHO-15). Query: `week` = any YYYY-MM-DD in the wanted Mon-Sun
 * week; omitted means the last complete week. A week that has not begun is refused.
 */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const raw = event.url.searchParams.get('week');
	const week = raw === null ? undefined : dateStr(raw);
	return handle(() => weeklySummary(getDb(), { week }));
};
