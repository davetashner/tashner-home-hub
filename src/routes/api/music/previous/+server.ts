import { json } from '@sveltejs/kit';
import { musicResponse } from '#lib/server/music/http.js';
import { previous } from '#lib/server/music/playback.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () =>
	musicResponse(async () => {
		await previous();
		return json({ ok: true });
	});
