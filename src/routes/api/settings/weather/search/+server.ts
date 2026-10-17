import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { searchPlaces } from '#lib/server/weather.js';
import type { RequestHandler } from './$types';

/** Adult only. `?q=` city or postal code; answers with up to six places. */
export const GET: RequestHandler = async (event) => {
	requireAdult(event);
	return json({ results: await searchPlaces(event.url.searchParams.get('q') ?? '') });
};
