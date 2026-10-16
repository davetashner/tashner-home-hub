import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { householdTimeZone, setHouseholdTimeZone } from '#lib/server/household.js';
import type { RequestHandler } from './$types';

/** Household settings. `timeZone` (IANA) decides chores' "today" and floating calendar times. */
export const GET: RequestHandler = () => json({ timeZone: householdTimeZone(getDb()) });

/** Adult only. Body: { timeZone } as an IANA zone name such as "America/Chicago". */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const zone = setHouseholdTimeZone(getDb(), body.timeZone);
	if (!zone) error(400, 'timeZone must be an IANA time zone such as America/Chicago');
	return json({ timeZone: zone });
};
