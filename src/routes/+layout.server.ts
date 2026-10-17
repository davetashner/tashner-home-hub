import { isAdult } from '#lib/server/auth.js';
import { displayRole } from '#lib/server/display-role.js';
import { getDb } from '#lib/server/db/index.js';
import { householdTimeZone } from '#lib/server/household.js';
import type { LayoutServerLoad } from './$types';

/**
 * Whether an adult session is active, so the header can offer Lock (never the adult's identity),
 * and the household zone, which wins over the kiosk browser's own zone for "today" and the clock.
 */
export const load: LayoutServerLoad = (event) => ({
	adult: isAdult(event),
	displayRole: displayRole(event),
	timeZone: householdTimeZone(getDb())
});
