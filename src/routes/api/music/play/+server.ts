import { json } from '@sveltejs/kit';
import { readJson, str } from '#lib/server/api.js';
import { musicResponse } from '#lib/server/music/http.js';
import { playPlaylist } from '#lib/server/music/playback.js';
import type { RequestHandler } from './$types';

/** Body: { playlistId }. Only playlists on the curated list play. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	const id = str(body.playlistId, 'playlistId');
	return musicResponse(async () => {
		await playPlaylist(id);
		return json({ ok: true });
	});
};
