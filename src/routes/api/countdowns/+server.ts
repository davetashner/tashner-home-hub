import { getDb } from '#lib/server/db/index.js';
import {
	createCountdown,
	createCountdownFromEvent,
	listCountdowns
} from '#lib/server/domain/countdowns.js';
import { householdTimeZone } from '#lib/server/household.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/**
 * Every countdown, soonest first; linked ones follow their calendar event (CD-4).
 * The home screen filters out the expired and far-off ones.
 */
export const GET: RequestHandler = () => {
	const db = getDb();
	return handle(() => listCountdowns(db, householdTimeZone(db)));
};

/**
 * Body: { title, targetDate (YYYY-MM-DD), icon? }, or { eventId, icon? } to count down to a
 * calendar event (CD-4). Kids may add countdowns too (CD-2). An event that already has a
 * countdown answers 200 with it.
 */
export const POST: RequestHandler = async (event) => {
	const body = await readJson(event.request);
	const db = getDb();
	const icon = body.icon as string | null | undefined;
	if (body.eventId !== undefined) {
		let created = false;
		const res = handle(() => {
			const r = createCountdownFromEvent(db, body.eventId, householdTimeZone(db), icon);
			created = r.created;
			return r.countdown;
		});
		return new Response(res.body, { status: created ? 201 : res.status, headers: res.headers });
	}
	const res = handle(() =>
		createCountdown(db, {
			title: body.title as string,
			targetDate: body.targetDate as string,
			icon
		})
	);
	return new Response(res.body, { status: 201, headers: res.headers });
};
