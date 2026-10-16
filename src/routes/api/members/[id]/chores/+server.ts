import { getDb } from '#lib/server/db/index.js';
import { choresForDay } from '#lib/server/domain/chores.js';
import { dateStr, handle, localDate } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Query: `date=YYYY-MM-DD` (default today), `tz` (IANA zone, default server zone). */
export const GET: RequestHandler = ({ params, url }) => {
	const raw = url.searchParams.get('date');
	const date = raw === null ? localDate(Date.now()) : dateStr(raw);
	const tz = url.searchParams.get('tz') ?? undefined;
	return handle(() => choresForDay(getDb(), params.id, date, tz));
};
