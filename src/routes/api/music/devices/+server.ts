import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { musicResponse } from '#lib/server/music/http.js';
import { listDevices } from '#lib/server/music/index.js';
import type { RequestHandler } from './$types';

/** Spotify Connect devices that are online right now. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return musicResponse(async () => json(await listDevices()));
};
