import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	clearWeatherLocation,
	readWeatherLocation,
	saveWeatherLocation
} from '#lib/server/weather.js';
import type { RequestHandler } from './$types';

/** The saved weather location and unit, or `{ location: null }` while weather is off. */
export const GET: RequestHandler = () => json({ location: readWeatherLocation(getDb()) });

/** Adult only. Body: { lat, lon, name?, unit?: "F" | "C" }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const loc = saveWeatherLocation(getDb(), await readJson(event.request));
	if (!loc) error(400, 'lat (-90..90) and lon (-180..180) are required');
	return json({ location: loc });
};

/** Adult only. Turns weather off. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	clearWeatherLocation(getDb());
	return json({ location: null });
};
