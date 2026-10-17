import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { disconnectSpotify } from '#lib/server/spotify/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	requireAdult(event);
	disconnectSpotify();
	return json({ state: 'disconnected' });
};
