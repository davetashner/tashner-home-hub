import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getWeather } from '#lib/server/weather.js';
import type { RequestHandler } from './$types';

/** Current weather and the 5-day forecast. `{ enabled: false }` until a location is set. Never slow. */
export const GET: RequestHandler = () => {
	const view = getWeather(getDb());
	return json(view ? { enabled: true, ...view } : { enabled: false });
};
