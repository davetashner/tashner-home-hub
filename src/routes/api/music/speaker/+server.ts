import { json } from '@sveltejs/kit';
import { speakerStatus } from '#lib/server/speaker.js';
import type { RequestHandler } from './$types';

/** The Pi speaker's state. Anyone may read it: the kid Music tab shows when it is asleep. */
export const GET: RequestHandler = async () =>
	json(await speakerStatus(), { headers: { 'cache-control': 'no-store' } });
