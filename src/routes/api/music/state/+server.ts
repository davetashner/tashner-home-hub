import { json } from '@sveltejs/kit';
import { musicState } from '#lib/server/music/playback.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await musicState());
