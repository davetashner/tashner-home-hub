import { json } from '@sveltejs/kit';
import { recordPowerEvent } from '#lib/server/display.js';
import type { RequestHandler } from './$types';

/** Touch to wake (SLP-3): the Pi agent calls this when the screen is touched while off. */
export const POST: RequestHandler = () =>
	json(recordPowerEvent('wake'), { headers: { 'cache-control': 'no-store' } });
