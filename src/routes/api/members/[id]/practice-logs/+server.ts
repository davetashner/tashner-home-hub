import { getDb } from '#lib/server/db/index.js';
import {
	logPractice,
	practiceSummary,
	practiceWeek,
	undoPractice
} from '#lib/server/domain/practice-logs.js';
import { isAdult } from '#lib/server/auth.js';
import { isDate } from '#lib/domain/practice-week.js';
import { LedgerError } from '#lib/server/domain/ledger.js';
import { handle, readJson, str } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Today's reading and practice per activity: minutes, stars, minutes to the next star, whether the
 * daily cap is reached, and the newest log (for undo). Open: the kid screen reads it.
 * With `?week=YYYY-MM-DD` (any day in the wanted week, or `current`; Monday first) it returns that week instead:
 * { weekStart, today, days[7]{date,minutes,isToday,byActivity}, activities, activityInfo,
 * totalMinutes, stars }.
 */
export const GET: RequestHandler = ({ params, url }) =>
	handle(() => {
		const week = url.searchParams.get('week');
		if (week === null) return practiceSummary(getDb(), params.id, Date.now());
		if (week === 'current') return practiceWeek(getDb(), params.id, Date.now());
		if (!isDate(week)) throw new LedgerError('invalid', 'week must be a date, YYYY-MM-DD');
		return practiceWeek(getDb(), params.id, Date.now(), week);
	});

/**
 * Body: { activityId, minutes }. A kid logs their own minutes with no sign-in and no approval:
 * the stars are approved at once (hub-kko.2). Returns { log, stars, summary }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await readJson(request);
	const res = handle(() =>
		logPractice(getDb(), {
			memberId: params.id,
			activityId: str(b.activityId, 'activityId'),
			minutes: b.minutes as number,
			now: Date.now()
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};

/** Body: { logId }. Takes a log back: a kid within the undo window, a signed-in grown-up any time. */
export const DELETE: RequestHandler = async (event) => {
	const b = await readJson(event.request);
	return handle(() =>
		undoPractice(getDb(), str(b.logId, 'logId'), {
			memberId: event.params.id,
			now: Date.now(),
			byAdult: isAdult(event)
		})
	);
};
