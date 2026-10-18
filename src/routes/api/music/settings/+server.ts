import { json } from '@sveltejs/kit';
import { readJson } from '#lib/server/api.js';
import { requireAdult } from '#lib/server/auth.js';
import { getMusicConfig, saveMusicConfig } from '#lib/server/music/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json(getMusicConfig());
};

/** Body: any of { playlists, volumeCap, timerMinutes, device }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const body = await readJson(event.request);
	const patch: Record<string, unknown> = {};
	for (const k of ['playlists', 'volumeCap', 'timerMinutes', 'device'])
		if (k in body) patch[k] = body[k];
	return json(saveMusicConfig(patch));
};
