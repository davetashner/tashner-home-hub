import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { parseVacation } from '#lib/domain/vacation.js';
import {
	clearVacation,
	endVacationNow,
	readVacation,
	setVacation
} from '#lib/server/domain/vacation.js';
import type { RequestHandler } from './$types';

/** The household vacation range, or { vacation: null }. Readable by the kid screens. */
export const GET: RequestHandler = () => json({ vacation: readVacation(getDb()) });

/**
 * Adult only. Body: { start: "YYYY-MM-DD", back?: "YYYY-MM-DD" | null }. `back` is the first day
 * back (after `start`); null or missing means on until turned off.
 */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const vacation = parseVacation(await readJson(event.request));
	if (!vacation) error(400, 'start must be a date and back a later date (YYYY-MM-DD)');
	return json({ vacation: setVacation(getDb(), vacation) });
};

/** Adult only. Ends vacation today: streaks resume tomorrow (a future vacation is removed). */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return json({ vacation: endVacationNow(getDb()) });
};

/** Adult only. Removes the vacation entirely. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	clearVacation(getDb());
	return json({ vacation: null });
};
