import { json } from '@sveltejs/kit';
import { readJson } from '#lib/server/api.js';
import { musicResponse } from '#lib/server/music/http.js';
import { setVolume } from '#lib/server/music/playback.js';
import type { RequestHandler } from './$types';

/** Body: { percent }. Clamped to the parent's cap; answers with the applied value. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	return musicResponse(async () => json({ percent: await setVolume(body.percent) }));
};
