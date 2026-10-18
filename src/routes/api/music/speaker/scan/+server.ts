import { requireAdult } from '#lib/server/auth.js';
import { scanSpeakers, speakerResponse } from '#lib/server/speaker.js';
import type { RequestHandler } from './$types';

/** Asks the Pi to look for Bluetooth devices nearby (about 8 s). */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return speakerResponse(() => scanSpeakers());
};
