import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { spotifyStatus } from '#lib/server/spotify/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(spotifyStatus());
};
