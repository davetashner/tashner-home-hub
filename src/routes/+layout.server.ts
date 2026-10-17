import { isAdult } from '#lib/server/auth.js';
import { displayRole } from '#lib/server/display-role.js';
import { getDb } from '#lib/server/db/index.js';
import { householdTimeZone } from '#lib/server/household.js';
import { readAppearanceData } from '#lib/server/appearance.js';
import { readWeatherLocation } from '#lib/server/weather.js';
import { readWaveBackground } from '#lib/server/wave-background.js';
import type { LayoutServerLoad } from './$types';

/** Only the coordinates leave the server for the sun maths (no name, no network). */
function waveLocation() {
	const loc = readWeatherLocation(getDb());
	return loc ? { lat: loc.lat, lon: loc.lon } : null;
}

const forcedDim = (v: string | undefined) => {
	const n = Number(v);
	return v && n >= 0.5 && n <= 1 ? n : null;
};

/**
 * Whether an adult session is active, so the header can offer Lock (never the adult's identity),
 * and the household zone, which wins over the kiosk browser's own zone for "today" and the clock.
 */
export const load: LayoutServerLoad = (event) => ({
	adult: isAdult(event),
	displayRole: displayRole(event),
	timeZone: householdTimeZone(getDb()),
	waveBackground: readWaveBackground(),
	waveLocation: waveLocation(),
	appearance: readAppearanceData(),
	/** Test seam (HUB_E2E_FORCE_DIM, 0.5-1): forces the evening look in automated browsers only. */
	forceDim: forcedDim(process.env.HUB_E2E_FORCE_DIM)
});
