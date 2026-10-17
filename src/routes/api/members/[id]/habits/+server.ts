import { getDb } from '#lib/server/db/index.js';
import { habitSummary } from '#lib/server/domain/habit-day.js';
import { dateStr, handle, localDate } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** Today's habit counter, the week's tally (Monday to today) and today's star. Query: `date`. */
export const GET: RequestHandler = ({ params, url }) => {
	const date = url.searchParams.get('date');
	return handle(() =>
		habitSummary(getDb(), params.id, date === null ? localDate(Date.now()) : dateStr(date))
	);
};
