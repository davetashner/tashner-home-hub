import { json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { musicResponse } from '#lib/server/music/http.js';
import { listLibrary } from '#lib/server/music/index.js';
import type { RequestHandler } from './$types';

/** The parent's own Spotify playlists, for the curation list. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return musicResponse(async () => json(await listLibrary()));
};
